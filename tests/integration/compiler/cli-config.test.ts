import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compilerMain } from "../../../apps/cli/src/wiz.ts";
import { temporaryDirectory } from "../../utils/filesystem.ts";

const roots: string[] = [];
const originalCwd = process.cwd();

afterEach(async () => {
    process.chdir(originalCwd);

    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

test("all CLI tooling rejects invalid configuration consistently", async () => {
    const root = await temporaryDirectory("wiz-invalid-config-");

    roots.push(root);

    await mkdir(join(root, "src"));

    await writeFile(join(root, "src", "main.wiz"), "printf ok\n");

    await writeFile(
        join(root, "config.wiz.json"),
        JSON.stringify({
            formatter: {
                indentWidth: 0,
            },
        }),
    );

    process.chdir(root);

    const errors: string[] = [];

    const error = spyOn(console, "error").mockImplementation((value) => {
        errors.push(String(value));
    });

    try {
        expect(await compilerMain(["build"])).toBe(1);

        expect(await compilerMain(["check"])).toBe(1);

        expect(await compilerMain(["format", "--check"])).toBe(1);

        expect(await compilerMain(["lint"])).toBe(1);

        expect(await compilerMain(["config"])).toBe(1);

        expect(errors).toContainEqual(
            expect.stringContaining("formatter.indentWidth"),
        );
    } finally {
        error.mockRestore();
    }
});

test("configured include and exclude globs control project builds", async () => {
    const root = await temporaryDirectory("wiz-config-files-");

    roots.push(root);

    await mkdir(join(root, "src", "generated"), { recursive: true });

    await writeFile(join(root, "src", "main.wiz"), "printf main\n");

    await writeFile(
        join(root, "src", "generated", "ignored.wiz"),
        "printf ignored\n",
    );

    await writeFile(
        join(root, "config.wiz.json"),
        JSON.stringify({
            compiler: {
                rootDir: "./src",
                outDir: "./dist",
            },
            files: {
                include: ["src/**/*.wiz"],
                exclude: ["src/generated/**"],
            },
        }),
    );

    process.chdir(root);

    expect(await compilerMain(["build"])).toBe(0);

    expect(await Bun.file(join(root, "dist", "main.sh")).exists()).toBe(true);

    expect(
        await Bun.file(join(root, "dist", "generated", "ignored.sh")).exists(),
    ).toBe(false);
});

test("CLI target overrides transpile explicit sh and zsh sources", async () => {
    const root = await temporaryDirectory("wiz-shell-targets-");

    roots.push(root);

    await mkdir(join(root, "src"));

    await writeFile(
        join(root, "src", "portable.sh"),
        "name=world\nprintf 'Hello, %s!\\n' \"$name\"\n",
    );

    await writeFile(
        join(root, "src", "portable.zsh"),
        "name=world\nprintf 'Hello, %s!\\n' \"$name\"\n",
    );

    process.chdir(root);

    expect(
        await compilerMain(["build", "src/portable.sh", "--target", "zsh"]),
    ).toBe(0);

    expect(await Bun.file(join(root, "dist", "portable.zsh")).exists()).toBe(
        true,
    );

    expect(
        await compilerMain(["build", "src/portable.zsh", "--target", "sh"]),
    ).toBe(0);

    const output = join(root, "dist", "portable.sh");

    expect(await Bun.file(output).exists()).toBe(true);

    const execution = Bun.spawnSync(["sh", output]);

    expect(execution.exitCode).toBe(0);

    expect(execution.stdout.toString()).toBe("Hello, world!\n");
});

test("lint fixes are rechecked before choosing the exit status", async () => {
    const root = await temporaryDirectory("wiz-lint-fix-");

    roots.push(root);

    await mkdir(join(root, "src"));

    const sourcePath = join(root, "src", "main.wiz");

    await writeFile(
        sourcePath,
        "declare -T string value=ok\nprintf '%s\\n' $value\n",
    );

    await writeFile(
        join(root, "config.wiz.json"),
        JSON.stringify({
            linter: {
                rules: {
                    "safety/no-unquoted-expansion": "error",
                    "safety/no-word-splitting-assumption": "off",
                },
            },
        }),
    );

    process.chdir(root);

    expect(await compilerMain(["lint", "--fix"])).toBe(0);

    expect(await Bun.file(sourcePath).text()).toContain('"$value"');
});
