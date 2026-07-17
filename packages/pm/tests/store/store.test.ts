import { afterEach, expect, test } from "bun:test";
import { readlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { temporaryDirectory } from "../../../../tests/utils/filesystem.ts";
import { manifest } from "../../../../tests/utils/fixtures.ts";
import { createRepository } from "../../../../tests/utils/git.ts";
import {
    ensureStored,
    replaceSymlink,
    repositoryHash,
} from "../../src/dependencies/store.ts";

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

test("stores immutable commits and reuses them", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    const repo = join(root, "repo");

    const commit = await createRepository(repo, manifest("dep"));

    const home = join(root, "home");

    const firstStorePath = await ensureStored(home, repo, commit);

    const reusedStorePath = await ensureStored(home, repo, commit);

    const link = join(root, "modules", "dep");

    await replaceSymlink(link, firstStorePath);

    const linkedPath = await readlink(link);

    expect(reusedStorePath).toBe(firstStorePath);

    expect(linkedPath).toBe(firstStorePath);
});

test("repository hashes separate identities", () => {
    const firstHash = repositoryHash("a");

    const secondHash = repositoryHash("b");

    expect(firstHash).not.toBe(secondHash);
});
