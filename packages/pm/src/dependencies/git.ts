import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { GitDependencySpec } from "../types.ts";
import { WizError } from "../utils/errors.ts";

export interface GitResult {
    stdout: string;
    stderr: string;
}

export function redactGitUrl(value: string): string {
    return value.replace(/(https?:\/\/)[^/@\s]+@/g, "$1***@");
}

export async function git(
    args: readonly string[],
    cwd?: string,
): Promise<GitResult> {
    let processHandle: Bun.ReadableSubprocess;

    try {
        processHandle = Bun.spawn(["git", ...args], {
            ...(cwd === undefined ? {} : { cwd }),
            stdout: "pipe",
            stderr: "pipe",
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        });
    } catch {
        throw new WizError("Git executable is unavailable");
    }

    const [stdout, stderr, code] = await Promise.all([
        new Response(processHandle.stdout).text(),
        new Response(processHandle.stderr).text(),
        processHandle.exited,
    ]);

    if (code !== 0) {
        throw new WizError(
            `Git failed: ${redactGitUrl(stderr.trim() || args.join(" "))}`,
        );
    }

    return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
    };
}

export function normalizeRepo(
    repo: string,
    baseDirectory = process.cwd(),
): string {
    if (isAbsolute(repo)) {
        return resolve(repo);
    }

    if (!/^(https?:\/\/|ssh:\/\/|git@)/.test(repo)) {
        return resolve(baseDirectory, repo);
    }

    return repo.replace(/\/$/, "");
}

export async function currentCommit(root: string): Promise<string> {
    return (await git(["rev-parse", "HEAD"], root)).stdout;
}

export async function resolveGit(
    spec: GitDependencySpec,
    baseDirectory: string,
): Promise<{ repo: string; commit: string; branch?: string }> {
    const repo = normalizeRepo(spec.repo, baseDirectory);

    const temp = await mkdtemp(join(tmpdir(), "wiz-resolve-"));

    try {
        await git(["clone", "--no-checkout", "--filter=blob:none", repo, temp]);

        let branch = spec.branch;

        if (branch === undefined && spec.commit === undefined) {
            const symbolic = (
                await git(["symbolic-ref", "refs/remotes/origin/HEAD"], temp)
            ).stdout;

            branch = symbolic.replace("refs/remotes/origin/", "");
        }

        if (branch !== undefined) {
            await git(["fetch", "origin", branch], temp);
        }

        if (spec.commit !== undefined) {
            try {
                await git(["fetch", "--depth=1", "origin", spec.commit], temp);
            } catch {
                await git(["fetch", "--unshallow", "origin"], temp).catch(
                    async () => {
                        return git(["fetch", "origin"], temp);
                    },
                );
            }
        }

        const reference =
            spec.commit ??
            (branch === undefined ? "origin/HEAD" : `origin/${branch}`);

        const commit = (await git(["rev-parse", `${reference}^{commit}`], temp))
            .stdout;

        if (branch !== undefined && spec.commit !== undefined) {
            const check = Bun.spawn(
                [
                    "git",
                    "merge-base",
                    "--is-ancestor",
                    commit,
                    `origin/${branch}`,
                ],
                { cwd: temp, stdout: "ignore", stderr: "ignore" },
            );

            if ((await check.exited) !== 0) {
                throw new WizError(
                    `Commit ${spec.commit} is not reachable from branch ${branch}`,
                );
            }
        }

        return { repo, commit, ...(branch === undefined ? {} : { branch }) };
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
}
