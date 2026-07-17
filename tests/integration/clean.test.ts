import { afterEach, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { temporaryDirectory } from "../utils/filesystem.ts";
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

test("clean requires confirmation before removing the Wiz home", async () => {
    const root = await createTestRoot();

    const home = join(root, "home");

    const wizHome = join(home, ".wiz");

    const state = join(wizHome, "state.json");

    await mkdir(wizHome, {
        recursive: true,
    });

    await writeFile(state, "{}");

    const cancelled = await runCli(root, ["clean"], home, "no\n");

    expect(cancelled).toMatchObject({
        code: 0,
        stdout: "Clean cancelled\n",
    });

    expect(cancelled.stderr).toContain(`Remove all Wiz data at ${wizHome}?`);

    expect(await Bun.file(state).exists()).toBe(true);

    const confirmed = await runCli(root, ["clean"], home, "yes\n");

    expect(confirmed).toMatchObject({
        code: 0,
        stdout: `Removed all Wiz data at ${wizHome}\n`,
    });

    expect(await Bun.file(wizHome).exists()).toBe(false);
});

test("clean supports explicit confirmation for automation", async () => {
    const root = await createTestRoot();

    const home = join(root, "home");

    const wizHome = join(home, ".wiz");

    await mkdir(wizHome, {
        recursive: true,
    });

    await writeFile(join(wizHome, "state.json"), "{}");

    const result = await runCli(root, ["clean", "--yes"], home);

    expect(result).toMatchObject({
        code: 0,
        stderr: "",
        stdout: `Removed all Wiz data at ${wizHome}\n`,
    });

    expect(await Bun.file(wizHome).exists()).toBe(false);
});
