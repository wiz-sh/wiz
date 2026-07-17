import { afterEach, expect, test } from "bun:test";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { executable, temporaryDirectory } from "../utils/filesystem.ts";
import { manifest } from "../utils/fixtures.ts";
import { createRepository } from "../utils/git.ts";
import { runCli } from "../utils/process.ts";

interface ProcessResult {
    code: number;
    stdout: string;
    stderr: string;
}

const roots: string[] = [];

async function createTestRoot(): Promise<string> {
    const root = await temporaryDirectory();

    roots.push(root);

    return root;
}

async function runDirectBin(
    name: string,
    args: readonly string[],
    cwd: string,
    home: string,
): Promise<ProcessResult> {
    const child = Bun.spawn([name, ...args], {
        cwd,
        env: {
            ...process.env,
            HOME: home,
            PATH: `${home}/.wiz/bin:${home}/bin:${process.env.PATH ?? ""}`,
            WIZ_HOME: `${home}/.wiz`,
        },
        stdout: "pipe",
        stderr: "pipe",
    });

    const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ]);

    return {
        code,
        stdout,
        stderr,
    };
}

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await rm(root, {
            recursive: true,
            force: true,
        });
    }
});

test("link exposes live bins globally and overrides project dependencies", async () => {
    const root = await createTestRoot();

    const library = join(root, "library");

    const tools = join(root, "tools");

    const consumer = join(root, "consumer");

    const home = join(root, "home");

    const cliPath = new URL("../../apps/cli/src/cli.ts", import.meta.url)
        .pathname;

    const binSource = join(tools, "bin/hello");

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
            package: {
                index: "src/index.sh",
            },
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
            "src/index.sh": "TOOLS=linked\n",
        },
    );

    await mkdir(consumer);

    await writeFile(
        join(consumer, "manifest.json"),
        manifest("consumer", {
            dependencies: {
                tools: {
                    repo: tools,
                },
            },
        }),
    );

    const installResult = await runCli(consumer, ["install"], home);

    const globalLink = await runCli(tools, ["link"], home);

    const directBeforeEdit = await runDirectBin(
        "hello",
        ["direct"],
        root,
        home,
    );

    const globalUnscoped = await runCli(root, ["x", "hello", "global"], home);

    const globalScoped = await runCli(
        root,
        ["x", "tools/hello", "scoped"],
        home,
    );

    expect(installResult.code).toBe(0);

    expect(globalLink.code).toBe(0);

    expect(globalLink.stdout).toContain("Linked tools");

    expect(directBeforeEdit).toMatchObject({
        code: 0,
        stdout: "hello direct",
        stderr: "",
    });

    expect(globalUnscoped.stdout).toBe("hello global");

    expect(globalScoped.stdout).toBe("hello scoped");

    await executable(
        binSource,
        '#!/usr/bin/env bash\nsource "$(wiz resolve library)"\nhello "live-$1"\n',
    );

    const directAfterEdit = await runDirectBin("hello", ["edit"], root, home);

    const projectLink = await runCli(consumer, ["link", "tools"], home);

    const linkedScoped = await runCli(
        consumer,
        ["x", "tools/hello", "project"],
        home,
    );

    const reinstall = await runCli(consumer, ["install"], home);

    const linkedAfterInstall = await runCli(
        consumer,
        ["x", "hello", "reinstall"],
        home,
    );

    const resolved = await runCli(consumer, ["resolve", "tools"], home);

    expect(directAfterEdit.stdout).toBe("hello live-edit");

    expect(projectLink.code).toBe(0);

    expect(linkedScoped.stdout).toBe("hello live-project");

    expect(reinstall.code).toBe(0);

    expect(linkedAfterInstall.stdout).toBe("hello live-reinstall");

    expect(resolved.stdout.trim()).toBe(
        join(await realpath(tools), "src/index.sh"),
    );

    const projectUnlink = await runCli(consumer, ["unlink", "tools"], home);

    const restoredSnapshot = await runCli(
        consumer,
        ["x", "tools/hello", "snapshot"],
        home,
    );

    const globalList = await runCli(root, ["list", "--global"], home);

    const globalUnlink = await runCli(
        root,
        ["unlink", "--global", "tools"],
        home,
    );

    const wrapperExists = await Bun.file(join(home, ".wiz/bin/hello")).exists();

    const xAfterUnlink = await runCli(root, ["x", "hello"], home);

    expect(projectUnlink.code).toBe(0);

    expect(restoredSnapshot.stdout).toBe("hello snapshot");

    expect(globalList.stdout).toContain("tools (linked:");

    expect(globalUnlink.code).toBe(0);

    expect(wrapperExists).toBe(false);

    expect(xAfterUnlink.code).toBe(1);

    expect(xAfterUnlink.stderr).toContain("Bin not found: hello");
}, 20_000);
