import { expect, test } from "bun:test";
import { dirname, join, relative, resolve } from "node:path";
import {
    bindSourceFile,
    checkSourceFile,
    parseSourceFile,
} from "@wiz/compiler";
import { parseManifest } from "@wiz/pm";
import { Glob } from "bun";

const repositoryRoot = resolve(import.meta.dir, "../../..");

const typesRoot = join(repositoryRoot, "wiz/types");

test("official type packages have valid manifests and declaration syntax", async () => {
    const manifests = new Glob("*/manifest.json");

    const names = new Set<string>();

    for await (const path of manifests.scan(typesRoot)) {
        const text = await Bun.file(join(typesRoot, path)).text();

        const manifest = parseManifest(text, dirname(join(typesRoot, path)));

        names.add(manifest.package.name);

        expect(manifest.package.index).toEndWith(".d.wiz");
    }

    expect(names).toEqual(
        new Set([
            "@types/agents",
            "@types/cloud",
            "@types/common",
            "@types/compilers",
            "@types/coreutils",
            "@types/db",
            "@types/developer",
            "@types/disk",
            "@types/github",
            "@types/js",
            "@types/network",
            "@types/nix",
            "@types/python",
            "@types/security",
            "@types/shell",
            "@types/system",
            "@types/wiz",
        ]),
    );

    const declarations = new Glob("**/*.d.wiz");

    for await (const path of declarations.scan(typesRoot)) {
        const fileName = join(typesRoot, path);

        const text = await Bun.file(fileName).text();

        const parsed = parseSourceFile(text, fileName);

        expect(parsed.diagnostics, path).toEqual([]);

        // Explicit any would erase the option contracts these packages exist to provide.
        expect(text, path).not.toMatch(/:\s*any(?:\[\])?(?:\s*[,)]|\s*\|)/);
    }
});

test("aggregate entries import every declaration module in their package", async () => {
    const aggregates = new Glob("*/index.d.wiz");

    for await (const path of aggregates.scan(typesRoot)) {
        const fileName = join(typesRoot, path);

        const directory = dirname(fileName);

        const aggregate = await Bun.file(fileName).text();

        const declarations = new Glob("*.d.wiz");

        for await (const declaration of declarations.scan(directory)) {
            if (declaration === "index.d.wiz") {
                continue;
            }

            expect(
                aggregate,
                `${relative(repositoryRoot, fileName)} must import ${declaration}`,
            ).toContain(`source "./${declaration}"`);
        }
    }
});

test("requested language and tool commands are represented", async () => {
    const declarations = new Glob("**/*.d.wiz");

    const commands = new Set<string>();

    for await (const path of declarations.scan(typesRoot)) {
        const fileName = join(typesRoot, path);

        const parsed = parseSourceFile(
            await Bun.file(fileName).text(),
            fileName,
        );

        for (const statement of parsed.statements) {
            if (statement.kind === "ExternalCommandDeclaration") {
                commands.add(statement.name);
            }
        }
    }

    for (const command of [
        "adduser",
        "cc",
        "clang",
        "clang++",
        "claude",
        "codex",
        "g++",
        "gcc",
        "gh",
        "gpg",
        "go",
        "java",
        "javac",
        "nix",
        "nmap",
        "openssl",
        "pip",
        "pip3",
        "python",
        "python3",
        "rg",
        "rustc",
        "uv",
        "useradd",
        "wiz",
        "zig",
    ]) {
        expect(commands, `${command} should have a declaration`).toContain(
            command,
        );
    }
});

test("search and account packages reject unknown command options", async () => {
    const searchDeclarations = await Bun.file(
        join(typesRoot, "common/search.d.wiz"),
    ).text();

    const search = parseSourceFile(
        `${searchDeclarations}\nrg --definitely-invalid needle\n`,
        "search.wiz",
    );

    const searchResult = checkSourceFile(search, bindSourceFile(search));

    expect(searchResult.diagnostics).toContainEqual(
        expect.objectContaining({
            code: "WIZ4006",
            message: "Unknown option --definitely-invalid for rg",
        }),
    );

    const accountDeclarations = await Bun.file(
        join(typesRoot, "system/accounts.d.wiz"),
    ).text();

    const accounts = parseSourceFile(
        `${accountDeclarations}\nuseradd --definitely-invalid hazel\n`,
        "accounts.wiz",
    );

    // biome-ignore format: Keep the declaration binding visible beside the checked source.
    const accountResult = checkSourceFile(
        accounts,
        bindSourceFile(accounts),
    );

    expect(accountResult.diagnostics).toContainEqual(
        expect.objectContaining({
            code: "WIZ4001",
            message: expect.stringContaining("Argument 1 of useradd expects"),
        }),
    );
});

test("high-use declaration packages model native option ownership", async () => {
    const declarations = [
        join(typesRoot, "common/git.d.wiz"),
        join(typesRoot, "common/search.d.wiz"),
    ];

    const commands = new Map<
        string,
        ReturnType<typeof parseSourceFile>["statements"][number]
    >();

    for (const fileName of declarations) {
        const parsed = parseSourceFile(
            await Bun.file(fileName).text(),
            fileName,
        );

        for (const statement of parsed.statements) {
            if (statement.kind === "ExternalCommandDeclaration") {
                commands.set(statement.name, statement);
            }
        }
    }

    const git = commands.get("git");

    expect(git).toEqual(
        expect.objectContaining({
            kind: "ExternalCommandDeclaration",
            methods: expect.arrayContaining([
                expect.objectContaining({
                    name: "clone",
                    options: expect.arrayContaining([
                        expect.objectContaining({
                            names: ["-b", "--branch"],
                            valueName: "name",
                        }),
                    ]),
                }),
            ]),
        }),
    );

    for (const command of ["grep", "rg"]) {
        expect(commands.get(command)).toEqual(
            expect.objectContaining({
                direct: true,
                options: expect.arrayContaining([
                    expect.objectContaining({ names: expect.any(Array) }),
                ]),
                overloads: expect.any(Array),
            }),
        );
    }
});

test("ambient Wiz declarations cover the complete public CLI namespace", async () => {
    const fileName = join(typesRoot, "wiz/index.d.wiz");

    const parsed = parseSourceFile(await Bun.file(fileName).text(), fileName);

    const command = parsed.statements.find((statement) => {
        return (
            statement.kind === "ExternalCommandDeclaration" &&
            statement.name === "wiz"
        );
    });

    expect(command?.kind).toBe("ExternalCommandDeclaration");

    if (command?.kind !== "ExternalCommandDeclaration") {
        throw new Error("Expected the ambient Wiz command declaration");
    }

    const methods = new Set(
        command.methods.map((method) => {
            return method.name;
        }),
    );

    for (const name of [
        "cache",
        "check",
        "create",
        "doctor",
        "install",
        "registry",
        "watch",
        "why",
        "workspace",
    ]) {
        expect(methods, `wiz ${name} should be declared`).toContain(name);
    }

    const install = command.methods.find((method) => {
        return method.name === "install";
    });

    expect(install?.options).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                names: ["--commit"],
                conflicts: ["--branch"],
                valueName: "commit",
            }),
        ]),
    );
});
