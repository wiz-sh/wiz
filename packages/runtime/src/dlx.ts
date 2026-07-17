import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    ensureStored,
    type Manifest,
    materialize,
    readManifest,
    resolveDependencies,
    resolveGit,
    WizError,
    wizHome,
    writeLockfile,
} from "@wiz/pm";
import { runtimeEnvironment } from "./environment.ts";
import { executableInside, runExecutable } from "./runner.ts";

export interface DlxOptions {
    repo: string;
    branch?: string;
    commit?: string;
    bin?: string;
}

function defaultBin(manifest: Manifest, requested?: string): string {
    if (requested !== undefined) {
        if (manifest.bins[requested] === undefined) {
            throw new WizError(
                `Package ${manifest.package.name} does not expose bin ${requested}`,
            );
        }

        return requested;
    }

    if (manifest.bins[manifest.package.name] !== undefined) {
        return manifest.package.name;
    }

    const names = Object.keys(manifest.bins);

    if (names.length === 0) {
        throw new WizError(
            `Package ${manifest.package.name} does not expose a bin`,
        );
    }

    if (names.length > 1) {
        throw new WizError(
            `Package ${manifest.package.name} exposes multiple bins; use --bin <name>`,
        );
    }

    const name = names[0];

    if (name === undefined) {
        throw new WizError(
            `Package ${manifest.package.name} does not expose a bin`,
        );
    }

    return name;
}

/** Runs a fetched package from an isolated project without changing caller state. */
export async function dlx(
    options: DlxOptions,
    args: readonly string[],
): Promise<number> {
    const caller = process.cwd();

    const home = wizHome();

    const resolved = await resolveGit(
        {
            repo: options.repo,
            ...(options.branch === undefined ? {} : { branch: options.branch }),
            ...(options.commit === undefined ? {} : { commit: options.commit }),
        },
        caller,
    );

    const stored = await ensureStored(home, resolved.repo, resolved.commit);

    const manifest = await readManifest(stored);

    const binName = defaultBin(manifest, options.bin);

    const binPath = manifest.bins[binName];

    if (binPath === undefined) {
        throw new WizError(
            `Package ${manifest.package.name} does not expose bin ${binName}`,
        );
    }

    const lockfile = await resolveDependencies(manifest, {
        home,
        baseDirectory: resolved.repo,
    });

    const temporary = await mkdtemp(join(tmpdir(), "wiz-dlx-"));

    const packageRoot = join(temporary, "package");

    try {
        await cp(stored, packageRoot, {
            recursive: true,
        });

        // Approval is user-owned state and must never be inherited from fetched code.
        await rm(join(packageRoot, "wiz.approvals.json"), {
            force: true,
        });

        await materialize(packageRoot, lockfile);

        await writeLockfile(packageRoot, lockfile);

        const executable = await executableInside(packageRoot, binPath);

        const environment = runtimeEnvironment(
            packageRoot,
            packageRoot,
            manifest.package.name,
            {
                commit: resolved.commit,
                ...(resolved.branch === undefined
                    ? {}
                    : {
                          resolvedBranch: resolved.branch,
                      }),
            },
        );

        return await runExecutable(executable, args, caller, environment);
    } finally {
        await rm(temporary, {
            recursive: true,
            force: true,
        });
    }
}
