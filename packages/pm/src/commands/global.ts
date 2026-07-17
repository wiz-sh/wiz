import { access, cp, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { currentCommit, normalizeRepo } from "../dependencies/git.ts";
import { resolveDependencies } from "../dependencies/resolver.ts";
import {
    ensureStored,
    repositoryHash,
    storePath,
} from "../dependencies/store.ts";
import {
    readBinState,
    removeWrapper,
    writeBinState,
    writeWrapper,
} from "../global/bins.ts";
import { readGlobalLinks } from "../global/links.ts";
import {
    globalPackagePath,
    readGlobalPackages,
    writeGlobalPackages,
} from "../global/packages.ts";
import { wizHome } from "../project/discovery.ts";
import { writeLockfile } from "../project/lockfile.ts";
import { readManifest } from "../project/manifest.ts";
import {
    executableInside,
    lifecycleEnvironment,
} from "../scripts/lifecycle.ts";
import type { Lockfile } from "../types.ts";
import { WizError } from "../utils/errors.ts";
import { readDirectoryOrEmpty } from "../utils/filesystem.ts";
import { readProject } from "./context.ts";
import { list } from "./inspect.ts";
import { materialize } from "./materialize.ts";

async function pruneGlobalStore(dryRun: boolean): Promise<string[]> {
    const home = wizHome();

    const packages = await readGlobalPackages(home);

    const retainedPaths = new Set<string>();

    for (const item of Object.values(packages)) {
        retainedPaths.add(storePath(home, item.repo, item.commit));
    }

    const removed: string[] = [];

    const store = join(home, "store");

    const repositories = await readDirectoryOrEmpty(store);

    for (const repository of repositories) {
        const repositoryRoot = join(store, repository);

        const commits = await readDirectoryOrEmpty(repositoryRoot);

        for (const commit of commits) {
            const path = join(repositoryRoot, commit);

            if (retainedPaths.has(path)) {
                continue;
            }

            removed.push(path);

            if (!dryRun) {
                await rm(path, { recursive: true, force: true });
            }
        }
    }

    return removed;
}

async function pruneProjectModules(dryRun: boolean): Promise<string[]> {
    const state = await readProject();

    const modules = join(state.root, "wiz_modules");

    const expected = new Set([
        ".wiz",
        ...Object.keys(state.lockfile?.rootDependencies ?? {}),
    ]);

    const removed: string[] = [];

    for (const name of await readDirectoryOrEmpty(modules)) {
        if (expected.has(name)) {
            continue;
        }

        removed.push(name);

        if (!dryRun) {
            await rm(join(modules, name), { recursive: true, force: true });
        }
    }

    return removed;
}

export async function prune(
    global: boolean,
    dryRun: boolean,
): Promise<string[]> {
    if (global) {
        return pruneGlobalStore(dryRun);
    }

    return pruneProjectModules(dryRun);
}

async function prepareGlobalPackage(
    source: string,
    destination: string,
    lockfile: Lockfile,
): Promise<void> {
    const temporary = `${destination}.tmp-${crypto.randomUUID()}`;

    await mkdir(dirname(destination), {
        recursive: true,
    });

    try {
        await cp(source, temporary, {
            recursive: true,
        });

        await materialize(temporary, lockfile);

        await writeLockfile(temporary, lockfile);

        await rm(destination, {
            recursive: true,
            force: true,
        });

        await rename(temporary, destination);
    } catch (err) {
        await rm(temporary, {
            recursive: true,
            force: true,
        });

        throw err;
    }
}

export async function installGlobal(): Promise<void> {
    const state = await readProject();

    await access(join(state.root, ".git"));

    const commit = await currentCommit(state.root);

    const repo = normalizeRepo(state.root);

    const home = wizHome();

    const stored = await ensureStored(home, repo, commit);

    const manifest = await readManifest(stored);

    const bins = await readBinState(home);

    const packages = await readGlobalPackages(home);

    const links = await readGlobalLinks(home);

    if (links[manifest.package.name] !== undefined) {
        throw new WizError(
            `Package is already linked globally: ${manifest.package.name}`,
        );
    }

    for (const name of Object.keys(manifest.bins)) {
        const existing = bins[name];

        for (const linked of Object.values(links)) {
            if (linked.bins[name] !== undefined) {
                throw new WizError(`Global bin collision: ${name}`);
            }
        }

        if (
            existing !== undefined &&
            (existing.repo !== repo || existing.commit !== commit)
        ) {
            throw new WizError(`Global bin collision: ${name}`);
        }
    }

    const resolved = await resolveDependencies(manifest, {
        home,
        baseDirectory: state.root,
        ...(state.lockfile === undefined
            ? {}
            : {
                  locked: state.lockfile,
              }),
    });

    const packageRoot = globalPackagePath(home, repo, commit);

    await prepareGlobalPackage(stored, packageRoot, resolved);

    const environment = lifecycleEnvironment(
        packageRoot,
        packageRoot,
        manifest.package.name,
        {
            commit,
        },
    );

    for (const [name, path] of Object.entries(manifest.bins)) {
        await executableInside(packageRoot, path);

        bins[name] = {
            package: manifest.package.name,
            repo,
            commit,
            bin: name,
            path,
        };

        await writeWrapper(home, name, join(packageRoot, path), environment);
    }

    await writeBinState(home, bins);

    packages[`${repositoryHash(repo)}@${commit}`] = {
        name: manifest.package.name,
        repo,
        commit,
    };

    await writeGlobalPackages(home, packages);
}

export async function removeGlobal(name: string): Promise<void> {
    const home = wizHome();

    const packages = await readGlobalPackages(home);

    const bins = await readBinState(home);

    const removedPackageIds: string[] = [];

    const removedRevisions = new Set<string>();

    const removedRoots = new Set<string>();

    for (const [id, item] of Object.entries(packages)) {
        if (item.name !== name) {
            continue;
        }

        removedPackageIds.push(id);

        removedRevisions.add(`${item.repo}\0${item.commit}`);

        removedRoots.add(globalPackagePath(home, item.repo, item.commit));

        delete packages[id];
    }

    if (removedPackageIds.length === 0) {
        throw new WizError(`Globally installed package not found: ${name}`);
    }

    for (const [binName, item] of Object.entries(bins)) {
        const revision = `${item.repo}\0${item.commit}`;

        if (!removedRevisions.has(revision)) {
            continue;
        }

        delete bins[binName];

        await removeWrapper(home, binName);
    }

    await writeBinState(home, bins);

    await writeGlobalPackages(home, packages);

    for (const root of removedRoots) {
        await rm(root, {
            recursive: true,
            force: true,
        });
    }

    await pruneGlobalStore(false);
}

function parseBinTarget(scoped: string): {
    packageName: string;
    binName: string;
} {
    const slash = scoped.indexOf("/");

    if (slash < 1) {
        throw new WizError("Bin target must be package/bin");
    }

    return {
        packageName: scoped.slice(0, slash),
        binName: scoped.slice(slash + 1),
    };
}

export async function binSet(name: string, scoped: string): Promise<void> {
    const target = parseBinTarget(scoped);

    const home = wizHome();

    const state = await readBinState(home);

    const source = Object.values(state).find((item) => {
        return (
            item.package === target.packageName && item.bin === target.binName
        );
    });

    if (source === undefined) {
        throw new WizError(`Globally installed bin not found: ${scoped}`);
    }

    state[name] = source;

    const packageRoot = globalPackagePath(home, source.repo, source.commit);

    const environment = lifecycleEnvironment(
        packageRoot,
        packageRoot,
        source.package,
        {
            commit: source.commit,
            ...(source.branch === undefined
                ? {}
                : {
                      resolvedBranch: source.branch,
                  }),
        },
    );

    await writeWrapper(home, name, join(packageRoot, source.path), environment);

    await writeBinState(home, state);
}

export async function binRemove(name: string): Promise<void> {
    const home = wizHome();

    const state = await readBinState(home);

    delete state[name];

    await removeWrapper(home, name);

    await writeBinState(home, state);
}

export async function binList(): Promise<string[]> {
    return list(true);
}
