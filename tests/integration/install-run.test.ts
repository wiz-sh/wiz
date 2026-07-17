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

async function createProject(root: string, source: string): Promise<string> {
    const project = join(root, "project");

    await mkdir(project);

    await writeFile(join(project, "manifest.json"), source);

    return project;
}

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

test("init creates a new project manifest", async () => {
    const root = await createTestRoot();

    const home = join(root, "home");

    const result = await runCli(root, ["init", "demo"], home);

    const manifest = await readFile(join(root, "manifest.json"), "utf8");

    const gitignore = await readFile(join(root, ".gitignore"), "utf8");

    expect(result).toMatchObject({
        code: 0,
        stdout: "Created manifest.json for demo\n",
        stderr: "",
    });

    expect(manifest).toContain('"name": "demo"');

    expect(gitignore).toBe("wiz_modules/\ndist/\n");

    expect(await Bun.file(join(root, "src/index.sh")).exists()).toBe(true);

    expect(await Bun.file(join(root, "config.wiz.json")).exists()).toBe(true);

    const repeatedResult = await runCli(root, ["init", "demo"], home);

    expect(repeatedResult.code).toBe(1);

    expect(repeatedResult.stderr).toContain("manifest.json already exists");
});

test("global bins run outside projects and can be removed", async () => {
    const root = await createTestRoot();

    const dependencyRoot = join(root, "dependency");

    const packageRoot = join(root, "package");

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
        dependencyRoot,
        manifest("library", {
            package: {
                index: "src/index.sh",
            },
        }),
        {
            "src/index.sh": "hello() { printf '%s' \"$1\"; }\n",
        },
    );

    await createRepository(
        packageRoot,
        manifest("tools", {
            bin: {
                hello: "bin/hello",
            },
            dependencies: {
                library: {
                    repo: dependencyRoot,
                },
            },
        }),
        {
            "bin/hello":
                '#!/usr/bin/env bash\nsource "$(wiz resolve library)"\nhello "$1"\n',
        },
    );

    const installResult = await runCli(
        packageRoot,
        ["install", "--global"],
        home,
    );

    const reinstallResult = await runCli(
        packageRoot,
        ["install", "--global"],
        home,
    );

    const executeResult = await runCli(
        root,
        ["x", "hello", "--", "hello world"],
        home,
    );

    const wrapper = Bun.spawn([join(home, ".wiz", "bin", "hello"), "direct"], {
        cwd: root,
        env: {
            ...process.env,
            HOME: home,
            PATH: `${home}/bin:${process.env.PATH ?? ""}`,
            WIZ_HOME: `${home}/.wiz`,
        },
        stdout: "pipe",
        stderr: "pipe",
    });

    const [wrapperStdout, wrapperStderr, wrapperExitCode] = await Promise.all([
        new Response(wrapper.stdout).text(),
        new Response(wrapper.stderr).text(),
        wrapper.exited,
    ]);

    expect(installResult.code).toBe(0);

    expect(reinstallResult.code).toBe(0);

    expect(executeResult).toMatchObject({
        code: 0,
        stdout: "hello world",
        stderr: "",
    });

    expect(wrapperExitCode).toBe(0);

    expect(wrapperStdout).toBe("direct");

    expect(wrapperStderr).toBe("");

    const removeResult = await runCli(root, ["rm", "-g", "tools"], home);

    const executeAfterRemoval = await runCli(root, ["x", "hello"], home);

    const globalListAfterRemoval = await runCli(
        root,
        ["list", "--global"],
        home,
    );

    const wrapperExists = await Bun.file(
        join(home, ".wiz", "bin", "hello"),
    ).exists();

    expect(removeResult.code).toBe(0);

    expect(executeAfterRemoval.code).toBe(1);

    expect(executeAfterRemoval.stderr).toContain("Bin not found: hello");

    expect(globalListAfterRemoval.stdout).toBe("");

    expect(wrapperExists).toBe(false);

    const repeatedRemoval = await runCli(
        root,
        ["remove", "--global", "tools"],
        home,
    );

    expect(repeatedRemoval.code).toBe(1);

    expect(repeatedRemoval.stderr).toContain(
        "Globally installed package not found: tools",
    );
});

test("install, lock, x, index and resolve workflow", async () => {
    const root = await createTestRoot();

    const dep = join(root, "dep");

    await createRepository(
        dep,
        manifest("dep", {
            package: {
                index: "lib.sh",
            },
            bin: {
                hello: "hello",
            },
        }),
        {
            "lib.sh": "VALUE=ok\n",
            hello: "#!/usr/bin/env bash\nprintf '%s' \"$1\"\n",
        },
    );

    const home = join(root, "home");

    const project = await createProject(
        root,
        manifest("project", {
            dependencies: {
                dep: {
                    repo: dep,
                },
            },
        }),
    );

    const installResult = await runCli(project, ["install"], home);

    const lockfile = await readFile(join(project, "wiz.lock.json"), "utf8");

    const installedManifest = await readFile(
        join(project, "wiz_modules", "dep", "manifest.json"),
        "utf8",
    );

    expect(installResult.code).toBe(0);

    expect(lockfile).toContain("dep@");

    expect(installedManifest).toContain('"name": "dep"');

    const executeResult = await runCli(
        project,
        ["x", "dep/hello", "--", "hello world"],
        home,
    );

    expect(executeResult).toMatchObject({
        code: 0,
        stdout: "hello world",
    });

    const indexResult = await runCli(project, ["index", "dep"], home);

    const resolveResult = await runCli(project, ["resolve", "dep"], home);

    expect(indexResult.stdout.trim()).toBe("wiz_modules/dep/lib.sh");

    expect(resolveResult.stdout.trim()).toEndWith(
        "/project/wiz_modules/dep/lib.sh",
    );

    const frozenInstallResult = await runCli(
        project,
        ["install", "--frozen-lockfile"],
        home,
    );

    expect(frozenInstallResult.code).toBe(0);

    const removeResult = await runCli(project, ["rm", "dep"], home);

    const manifestAfterRemoval = await readFile(
        join(project, "manifest.json"),
        "utf8",
    );

    expect(removeResult.code).toBe(0);

    expect(manifestAfterRemoval).toContain('"dependencies": {}');
});

test("official type packages install from Wiz without a registry", async () => {
    const root = await createTestRoot();

    const home = join(root, "home");

    const project = await createProject(
        root,
        manifest("project", {
            registries: { default: "http://127.0.0.1:1" },
        }),
    );

    const result = await runCli(project, ["i", "@types/common"], home);

    const savedManifest = await readFile(
        join(project, "manifest.json"),
        "utf8",
    );

    const installedIndex = join(
        project,
        "wiz_modules",
        "@types",
        "common",
        "index.d.wiz",
    );

    expect(result).toMatchObject({
        code: 0,
        stdout: "Added @types/common\n",
        stderr: "",
    });

    expect(savedManifest).toContain('"builtin": "types"');

    expect(await Bun.file(installedIndex).exists()).toBe(true);

    expect(
        (await runCli(project, ["install", "--frozen-lockfile"], home)).code,
    ).toBe(0);
});

test("run and script forward arguments and exit codes", async () => {
    const root = await createTestRoot();

    const home = join(root, "home");

    const project = await createProject(
        root,
        manifest("project", {
            scripts: {
                show: "printf '%s' \"$1\"",
            },
        }),
    );

    await executable(
        join(project, "tool"),
        "#!/usr/bin/env bash\nprintf '%s' \"$1\"\n",
    );

    const runResult = await runCli(project, ["run", "tool", "a b"], home);

    const scriptResult = await runCli(
        project,
        ["script", "show", "--", "c d"],
        home,
    );

    expect(runResult.stdout).toBe("a b");

    expect(scriptResult.stdout).toBe("c d");
});

test("info displays current package metadata and declarations", async () => {
    const root = await createTestRoot();

    const home = join(root, "home");

    const project = await createProject(
        root,
        manifest("demo", {
            package: {
                version: "1.2.0",
                description: "Demo package",
                license: "MIT",
                author: {
                    name: "Hazel",
                    email: "hazel@example.com",
                },
                contributors: [
                    {
                        name: "Sky",
                        email: "sky@example.com",
                        url: "https://example.com/sky",
                    },
                ],
                repository: {
                    type: "git",
                    url: "https://example.com/demo.git",
                    directory: "packages/demo",
                },
                keywords: ["bash", "demo"],
                index: "src/index.sh",
                links: {
                    documentation: "https://example.com/docs",
                },
            },
            scripts: {
                test: "./test.sh",
            },
            bin: {
                demo: "bin/demo",
            },
            dependencies: {
                logger: {
                    repo: "./logger",
                    branch: "main",
                },
            },
        }),
    );

    const result = await runCli(project, ["info"], home);

    const lines = result.stdout.trim().split("\n");

    expect(result.code).toBe(0);

    expect(result.stderr).toBe("");

    expect(lines).toEqual([
        "Name: demo",
        "Version: 1.2.0",
        "Description: Demo package",
        "License: MIT",
        "Author: Hazel <hazel@example.com>",
        "Contributor: Sky <sky@example.com> (https://example.com/sky)",
        "Repository: https://example.com/demo.git (directory: packages/demo)",
        "Keywords: bash, demo",
        "Index: src/index.sh",
        "Link (documentation): https://example.com/docs",
        "Dependency (logger): ./logger [main]",
        "Bin (demo): bin/demo",
        "Script (test): ./test.sh",
    ]);
});

test("info reports a missing project on stderr", async () => {
    const root = await createTestRoot();

    const result = await runCli(root, ["info"], join(root, "home"));

    expect(result.code).toBe(1);

    expect(result.stdout).toBe("");

    expect(result.stderr).toContain("No manifest.json found");
});
