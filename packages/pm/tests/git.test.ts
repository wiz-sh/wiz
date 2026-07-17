import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { temporaryDirectory } from "../../../tests/utils/filesystem.ts";
import { manifest } from "../../../tests/utils/fixtures.ts";
import { createRepository, gitCommand } from "../../../tests/utils/git.ts";
import {
    normalizeRepo,
    redactGitUrl,
    resolveGit,
} from "../src/dependencies/git.ts";

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

test("resolves branch heads and exact commits", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    const repo = join(root, "repo");

    const commit = await createRepository(repo, manifest("dep"));

    const branchResolution = await resolveGit({ repo, branch: "main" }, root);

    const commitResolution = await resolveGit({ repo, commit }, root);

    expect(branchResolution.commit).toBe(commit);

    expect(commitResolution.commit).toBe(commit);

    await gitCommand(repo, ["branch", "feature/x"]);

    const featureResolution = await resolveGit(
        {
            repo,
            branch: "feature/x",
        },
        root,
    );

    expect(featureResolution.branch).toBe("feature/x");
});

test("normalizes local repos", () => {
    const normalized = normalizeRepo("repo", "/tmp");

    expect(normalized).toBe("/tmp/repo");
});

test("redacts credentials", () => {
    const redacted = redactGitUrl("https://user:secret@example.com/repo.git");

    expect(redacted).toBe("https://***@example.com/repo.git");
});
