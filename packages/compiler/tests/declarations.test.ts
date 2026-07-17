import { expect, test } from "bun:test";
import {
    bindSourceFile,
    checkSourceFile,
    createStandardLibraryScope,
    getDocumentation,
    getStandardLibraryFiles,
    parseSourceFile,
    Scope,
} from "../src/index.ts";

test("declaration files bind external command signatures", () => {
    const declarations = parseSourceFile(
        `declare command service {
    restart(name: string, attempts: int): status
}
`,
        "commands.d.wiz",
    );

    const binding = bindSourceFile(declarations);

    expect(binding.globalScope.resolve("service")).toBeDefined();

    expect(declarations.declarationFile).toBe(true);
});

test("external command declarations check subcommand arguments", () => {
    const file = parseSourceFile(
        `declare command service {
    restart(name: string, attempts: int): status
}
service restart "web" wrong
`,
        "main.wiz",
    );

    const binding = bindSourceFile(file);

    const result = checkSourceFile(file, binding);

    expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
            code: "WIZ4001",
            message:
                "Argument 2 of service restart expects int, but received string",
        }),
    );
});

test("bundled declarations type default commands and captured output", () => {
    const file = parseSourceFile(
        `declare -T path project="$(realpath .)"
wiz root
`,
        "/workspace/main.wiz",
    );

    const binding = bindSourceFile(
        file,
        new Scope(createStandardLibraryScope()),
    );

    expect(binding.globalScope.resolve("wiz")).toBeDefined();

    expect(binding.globalScope.resolve("realpath")?.type.name).toBe("path");

    expect(checkSourceFile(file, binding).diagnostics).toEqual([]);
});

test("ambient shell and Wiz commands accept their typed native forms", () => {
    const file = parseSourceFile(
        `alias -p
export -f deploy
set -o pipefail
declare -a services
local -r name=wiz
wiz check "./main.wiz" --target bash
wiz watch "./main.wiz" -- --verbose
`,
        "/workspace/builtins.wiz",
    );

    const binding = bindSourceFile(
        file,
        new Scope(createStandardLibraryScope()),
    );

    expect(checkSourceFile(file, binding).diagnostics).toEqual([]);
});

test("ambient declaration packs only expose default shell tooling", () => {
    const libraries = getStandardLibraryFiles();

    const declarations = new Map<string, string>();

    for (const library of libraries) {
        expect(library.file.diagnostics).toEqual([]);

        for (const statement of library.file.statements) {
            if (
                statement.kind !== "ExternalCommandDeclaration" &&
                statement.kind !== "EnvironmentDeclaration"
            ) {
                continue;
            }

            expect(
                declarations.get(statement.name),
                `${statement.name} is declared by more than one ambient pack`,
            ).toBeUndefined();

            declarations.set(statement.name, library.name);
        }
    }

    const scope = createStandardLibraryScope();

    for (const command of ["echo", "realpath", "wiz"]) {
        expect(
            scope.resolve(command),
            `${command} should be declared`,
        ).toBeDefined();
    }

    expect(scope.resolve("git")).toBeUndefined();

    expect(scope.resolve("uv")).toBeUndefined();
});

test("direct external command declarations accept rest arguments", () => {
    const file = parseSourceFile(
        `declare command deploy(destination: path, ...arguments: string[]): status
deploy "/srv/app" "--force" "--verbose"
`,
        "commands.wiz",
    );

    const binding = bindSourceFile(file);

    const result = checkSourceFile(file, binding);

    expect(result.diagnostics).toEqual([]);
});

test("command option schemas validate values, requirements, conflicts, and overloads", () => {
    const file = parseSourceFile(
        `declare command search {
    option -g, --glob <pattern: string> repeatable
    option -j, --threads <count: int>
    option --json conflicts(--quiet)
    option -q, --quiet conflicts(--json)
    option --config <file: file> required
    overload(pattern: string, ...paths: path[]): stream
    overload(): stream
}
search --glob "*.ts" --threads nope --json --quiet "needle" ./src
`,
        "commands.wiz",
    );

    const declaration = file.statements[0];

    expect(declaration).toEqual(
        expect.objectContaining({
            kind: "ExternalCommandDeclaration",
            direct: true,
            options: expect.arrayContaining([
                expect.objectContaining({
                    names: ["-g", "--glob"],
                    repeatable: true,
                    valueName: "pattern",
                }),
            ]),
        }),
    );

    const binding = bindSourceFile(file);

    const result = checkSourceFile(file, binding);

    expect(result.diagnostics).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ code: "WIZ4001" }),
            expect.objectContaining({ code: "WIZ4008" }),
            expect.objectContaining({ code: "WIZ4009" }),
        ]),
    );
});

test("shell-native documentation comments expose descriptions and tags", () => {
    const file = parseSourceFile(
        `## Starts the application server.
##
## @param host Address to bind.
## @returns The command exit status.
## @example serve "127.0.0.1"
serve(string host): status {
    return 0
}
`,
        "documented.wiz",
    );

    const declaration = file.statements.find((statement) => {
        return statement.kind === "FunctionDeclaration";
    });

    expect(declaration).toBeDefined();

    if (declaration === undefined) {
        throw new Error("Expected a function declaration");
    }

    const documentation = getDocumentation(file, declaration);

    expect(documentation?.description).toBe("Starts the application server.");

    expect(documentation?.tags).toContainEqual({
        name: "param",
        parameter: "host",
        text: "Address to bind.",
    });

    expect(documentation?.markdown).toContain(
        '**Example:** `serve "127.0.0.1"`',
    );
});
