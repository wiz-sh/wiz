import { createHash } from "node:crypto";
import { access, mkdir, readlink, rename, rm, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isCodedError } from "../utils/errors.ts";
import { git } from "./git.ts";

export function repositoryHash(repo: string): string {
    return createHash("sha256").update(repo).digest("hex").slice(0, 24);
}
export function storePath(home: string, repo: string, commit: string): string {
    return join(home, "store", repositoryHash(repo), commit);
}

/** Materializes an exact commit once, then treats that repository/commit path as immutable. */
export async function ensureStored(
    home: string,
    repo: string,
    commit: string,
): Promise<string> {
    const destination = storePath(home, repo, commit);

    try {
        await access(join(destination, "manifest.json"));

        return destination;
    } catch {
        // A cache miss is expected; cloning below materializes the requested commit.
    }

    if (process.env.WIZ_OFFLINE === "true") {
        throw new Error(
            `Offline cache miss for ${repo} at ${commit}; disable WIZ_OFFLINE to fetch it`,
        );
    }

    const temporary = `${destination}.tmp-${crypto.randomUUID()}`;

    await mkdir(dirname(destination), { recursive: true });

    try {
        await git([
            "clone",
            "--no-checkout",
            "--filter=blob:none",
            repo,
            temporary,
        ]);

        try {
            await git(["fetch", "--depth=1", "origin", commit], temporary);
        } catch {
            await git(["fetch", "origin", commit], temporary);
        }

        await git(["checkout", "--detach", commit], temporary);

        await rm(join(temporary, ".git"), { recursive: true, force: true });

        try {
            await rename(temporary, destination);
        } catch (err) {
            await rm(temporary, { recursive: true, force: true });

            try {
                await access(join(destination, "manifest.json"));
            } catch {
                throw err;
            }
        }
    } catch (err) {
        await rm(temporary, { recursive: true, force: true });

        throw err;
    }

    return destination;
}

export async function replaceSymlink(
    link: string,
    target: string,
): Promise<void> {
    await mkdir(dirname(link), { recursive: true });

    const resolvedTarget = resolve(dirname(link), target);

    try {
        const existing = await readlink(link);

        if (resolve(dirname(link), existing) === resolvedTarget) {
            return;
        }
    } catch (err) {
        if (!(err instanceof Error) || !isCodedError(err)) {
            throw err;
        }

        if (err.code !== "ENOENT" && err.code !== "EINVAL") {
            throw err;
        }
    }

    const temporary = `${link}.tmp-${crypto.randomUUID()}`;

    await symlink(target, temporary, "dir");

    await rm(link, { recursive: true, force: true });

    await rename(temporary, link);
}
