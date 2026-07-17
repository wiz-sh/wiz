import { afterEach, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { executable, temporaryDirectory } from "../utils/filesystem.ts";
import { manifest } from "../utils/fixtures.ts";
import { createRepository } from "../utils/git.ts";
import { runCli } from "../utils/process.ts";

const roots: string[] = [];

async function createTestRoot(): Promise<string> {
    const root = await temporaryDirectory();

    roots.push(root);

    return root;
}

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await rm(root, {
            recursive: true,
            force: true,
        });
    }
});

test("install with a repository adds its named dependency and full graph", async () => {
    const root = await createTestRoot();

    const library = join(root, "library");

    const tools = join(root, "tools");

    const project = join(root, "project");

    const home = join(root, "home");

    const cliPath = new URL("../../apps/cli/src/cli.ts", import.meta.url)
        .pathname;

    await mkdir(join(home, "bin"), {
        recursive: true,
    });

    await executable(
        join(home, "bin", "wiz"),
        `#!/usr/bin/env bash\nexec bun ${JSON.stringify(cliPath)} "$@"\n`,
    );

    await createRepository(
        library,
        manifest("library", {
            package: {
                index: "src/index.sh",
            },
        }),
        {
            "src/index.sh": "hello() { printf 'hello %s' \"$1\"; }\n",
        },
    );

    await createRepository(
        tools,
        manifest("tools", {
            bin: {
                hello: "bin/hello",
            },
            dependencies: {
                library: {
                    repo: library,
                },
            },
        }),
        {
            "bin/hello":
                '#!/usr/bin/env bash\nsource "$(wiz resolve library)"\nhello "$1"\n',
        },
    );

    await mkdir(project);

    await writeFile(join(project, "manifest.json"), manifest("project"));

    const result = await runCli(
        project,
        ["i", tools, "--branch", "main"],
        home,
    );

    const execute = await runCli(project, ["x", "tools/hello", "world"], home);

    const savedManifest = await readFile(
        join(project, "manifest.json"),
        "utf8",
    );

    const lockfile = await readFile(join(project, "wiz.lock.json"), "utf8");

    expect(result).toMatchObject({
        code: 0,
        stdout: "Added tools\n",
        stderr: "",
    });

    expect(execute).toMatchObject({
        code: 0,
        stdout: "hello world",
        stderr: "",
    });

    expect(savedManifest).toContain(`"repo": ${JSON.stringify(tools)}`);

    expect(savedManifest).toContain('"branch": "main"');

    expect(lockfile).toContain('"name": "tools"');

    expect(lockfile).toContain('"name": "library"');

    expect(
        await Bun.file(
            join(project, "wiz_modules/tools/manifest.json"),
        ).exists(),
    ).toBe(true);

    expect(
        await Bun.file(
            join(
                project,
                "wiz_modules/tools/wiz_modules/library/manifest.json",
            ),
        ).exists(),
    ).toBe(true);

    expect(
        await Bun.file(
            join(project, "wiz_modules/library/manifest.json"),
        ).exists(),
    ).toBe(false);

    const repeated = await runCli(project, ["install", tools], home);

    expect(repeated.code).toBe(1);

    expect(repeated.stderr).toContain("Dependency already exists: tools");
});

test("failed repository addition leaves the manifest unchanged", async () => {
    const root = await createTestRoot();

    const project = join(root, "project");

    const home = join(root, "home");

    const source = manifest("project");

    await mkdir(project);

    await writeFile(join(project, "manifest.json"), source);

    const result = await runCli(
        project,
        ["install", join(root, "missing-repository")],
        home,
    );

    expect(result.code).toBe(1);

    expect(await readFile(join(project, "manifest.json"), "utf8")).toBe(source);

    expect(await Bun.file(join(project, "wiz.lock.json")).exists()).toBe(false);

    expect(await Bun.file(join(project, "wiz_modules")).exists()).toBe(false);
});
