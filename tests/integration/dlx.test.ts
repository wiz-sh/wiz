import { afterEach, expect, test } from "bun:test";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
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

test("dlx fetches and runs a package without adding a dependency", async () => {
    const root = await createTestRoot();

    const library = join(root, "library");

    const runner = join(root, "runner");

    const consumer = join(root, "consumer");

    const home = join(root, "home");

    const cliPath = new URL("../../apps/cli/src/cli.ts", import.meta.url)
        .pathname;

    const consumerManifest = manifest("consumer");

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
        runner,
        manifest("runner", {
            bin: {
                runner: "bin/runner",
                alternate: "bin/alternate",
            },
            dependencies: {
                library: {
                    repo: library,
                },
            },
        }),
        {
            "bin/runner":
                '#!/usr/bin/env bash\nsource "$(wiz resolve library)"\nhello "$1"\nprintf "|%s" "$PWD"\n',
            "bin/alternate":
                "#!/usr/bin/env bash\nprintf 'alternate %s' \"$1\"\n",
        },
    );

    await mkdir(consumer);

    await writeFile(join(consumer, "manifest.json"), consumerManifest);

    const result = await runCli(
        consumer,
        ["dlx", runner, "--branch", "main", "--", "world"],
        home,
    );

    const alternate = await runCli(
        consumer,
        ["dlx", runner, "--bin", "alternate", "second"],
        home,
    );

    const globalList = await runCli(consumer, ["list", "--global"], home);

    expect(result).toMatchObject({
        code: 0,
        stdout: `hello world|${await realpath(consumer)}`,
        stderr: "",
    });

    expect(alternate).toMatchObject({
        code: 0,
        stdout: "alternate second",
        stderr: "",
    });

    expect(await readFile(join(consumer, "manifest.json"), "utf8")).toBe(
        consumerManifest,
    );

    expect(await Bun.file(join(consumer, "wiz.lock.json")).exists()).toBe(
        false,
    );

    expect(await Bun.file(join(consumer, "wiz_modules")).exists()).toBe(false);

    expect(globalList.stdout).toBe("");
});

test("dlx reports packages without a selectable default bin", async () => {
    const root = await createTestRoot();

    const packageRoot = join(root, "package");

    const home = join(root, "home");

    await createRepository(
        packageRoot,
        manifest("tools", {
            bin: {
                first: "bin/first",
                second: "bin/second",
            },
        }),
        {
            "bin/first": "#!/usr/bin/env bash\nexit 0\n",
            "bin/second": "#!/usr/bin/env bash\nexit 0\n",
        },
    );

    const result = await runCli(root, ["dlx", packageRoot], home);

    expect(result.code).toBe(1);

    expect(result.stderr).toContain("exposes multiple bins; use --bin <name>");
});
