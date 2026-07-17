import { afterEach, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
    executable,
    temporaryDirectory,
} from "../../../tests/utils/filesystem.ts";
import { executableInside, runExecutable, runScript } from "../src/runner.ts";

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

test("validates and runs executables", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    const path = join(root, "ok");

    await executable(path, "#!/usr/bin/env bash\nexit 7\n");

    const executablePath = await executableInside(root, "ok");

    const exitCode = await runExecutable(executablePath, [], root);

    expect(exitCode).toBe(7);
});

test("manifest scripts support Bash syntax", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    const exitCode = await runScript(
        '[[ "$1" == "bash" ]]',
        ["bash"],
        root,
        {},
    );

    expect(exitCode).toBe(0);
});

test("rejects traversal and non-executable files", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    await writeFile(join(root, "plain"), "x");

    expect(executableInside(root, "../x")).rejects.toThrow("escapes");

    expect(executableInside(root, "plain")).rejects.toThrow("not executable");
});
