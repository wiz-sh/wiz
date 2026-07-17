import { afterEach, expect, test } from "bun:test";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { temporaryDirectory } from "../utils/filesystem.ts";
import { runCli } from "../utils/process.ts";

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

test("root finds the project from nested source and dist directories", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    await mkdir(join(root, "src", "nested"), { recursive: true });

    await mkdir(join(root, "dist"), { recursive: true });

    await writeFile(join(root, "config.wiz.json"), "{}");

    const expected = await realpath(root);

    expect(
        (
            await runCli(
                join(root, "src", "nested"),
                ["root"],
                join(root, ".home"),
            )
        ).stdout.trim(),
    ).toBe(expected);

    expect(
        (
            await runCli(join(root, "dist"), ["root"], join(root, ".home"))
        ).stdout.trim(),
    ).toBe(expected);
});

test("needs succeeds for installed binaries and explains missing requirements", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    expect(
        (await runCli(root, ["needs", "bash"], join(root, ".home"))).code,
    ).toBe(0);

    const missing = await runCli(
        root,
        ["needs", "definitely-not-a-wiz-test-binary"],
        join(root, ".home"),
    );

    expect(missing.code).toBe(1);

    expect(missing.stderr).toContain("Required binary is not installed");
});
