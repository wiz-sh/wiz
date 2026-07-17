import { join } from "node:path";
import { resolveGit } from "../dependencies/git.ts";
import { resolveDependencies } from "../dependencies/resolver.ts";
import { ensureStored, storePath } from "../dependencies/store.ts";
import {
    isScriptApproved,
    readScriptApprovals,
    writeScriptApprovals,
} from "../project/approvals.ts";
import { wizHome } from "../project/discovery.ts";
import {
    lockMatchesManifest,
    readLockfile,
    writeLockfile,
} from "../project/lockfile.ts";
import { readManifest, serializeManifest } from "../project/manifest.ts";
import {
    discoverWorkspaces,
    resolveWorkspacePackagePath,
} from "../project/workspaces.ts";
import type {
    GitDependencySpec,
    LockedPackage,
    Lockfile,
    Manifest,
} from "../types.ts";
import { WizError } from "../utils/errors.ts";
import { atomicWrite } from "../utils/filesystem.ts";
import { readProject } from "./context.ts";
import { materialize } from "./materialize.ts";

export interface AddOptions {
    repo: string;
    branch?: string;
    commit?: string;
}

export interface AddRegistryOptions {
    name: string;
    version?: string;
    registry?: string;
}

function reportPendingScripts(packages: readonly LockedPackage[]): void {
    if (packages.length === 0) {
        return;
    }

    const packageIds = packages
        .map((item) => {
            return item.id;
        })
        .join(", ");

    console.error(
        `Skipped unapproved postinstall scripts: ${packageIds}\n` +
            "Run wiz approve <package> to review and approve them.",
    );
}

async function ensurePackagesStored(
    packages: readonly LockedPackage[],
): Promise<void> {
    for (const item of packages) {
        if (item.workspacePath !== undefined) {
            continue;
        }

        if (item.source?.type === "registry" || item.source?.type === "local") {
            continue;
        }

        await ensureStored(wizHome(), item.repo, item.commit);
    }
}

function dependencySpec(options: AddOptions): GitDependencySpec {
    return {
        repo: options.repo,
        ...(options.branch === undefined ? {} : { branch: options.branch }),
        ...(options.commit === undefined ? {} : { commit: options.commit }),
    };
}

function resolutionSeed(
    state: Awaited<ReturnType<typeof readProject>>,
    name: string,
    repo: string,
    commit: string,
    requestedBranch: string | undefined,
    resolvedBranch: string | undefined,
): Lockfile {
    const discovered: LockedPackage = {
        id: `${name}@discovered:${commit}`,
        name,
        repo,
        commit,
        direct: true,
        dependencies: {},
        ...(requestedBranch === undefined ? {} : { requestedBranch }),
        ...(resolvedBranch === undefined ? {} : { resolvedBranch }),
    };

    return {
        lockfileVersion: 1,
        rootDependencies: state.lockfile?.rootDependencies ?? {},
        packages: [...(state.lockfile?.packages ?? []), discovered],
    };
}

/** Adds a Git-backed direct dependency only after its complete graph resolves. */
export async function add(options: AddOptions): Promise<string> {
    const state = await readProject();

    const spec = dependencySpec(options);

    const discovered = await resolveGit(spec, state.root);

    const stored = await ensureStored(
        wizHome(),
        discovered.repo,
        discovered.commit,
    );

    const dependencyManifest = await readManifest(stored);

    const name = dependencyManifest.package.name;

    if (state.manifest.dependencies[name] !== undefined) {
        throw new WizError(`Dependency already exists: ${name}`);
    }

    const updated: Manifest = {
        ...state.manifest,
        dependencies: {
            ...state.manifest.dependencies,
            [name]: spec,
        },
    };

    const seed = resolutionSeed(
        state,
        name,
        discovered.repo,
        discovered.commit,
        options.branch,
        discovered.branch,
    );

    const resolved = await resolveDependencies(updated, {
        home: wizHome(),
        baseDirectory: state.root,
        locked: seed,
    });

    const pending = await materialize(state.root, resolved);

    await atomicWrite(
        join(state.root, "manifest.json"),
        serializeManifest(updated),
    );

    await writeLockfile(state.root, resolved);

    reportPendingScripts(pending);

    return name;
}

/** Adds a registry dependency while preserving the existing Git-add workflow. */
export async function addRegistry(
    options: AddRegistryOptions,
): Promise<string> {
    const state = await readProject();

    if (state.manifest.dependencies[options.name] !== undefined) {
        throw new WizError(`Dependency already exists: ${options.name}`);
    }

    const updated: Manifest = {
        ...state.manifest,
        dependencies: {
            ...state.manifest.dependencies,
            [options.name]: {
                version: options.version ?? "latest",
                ...(options.registry === undefined
                    ? {}
                    : { registry: options.registry }),
            },
        },
    };

    const resolved = await resolveDependencies(updated, {
        home: wizHome(),
        baseDirectory: state.root,
        ...(state.lockfile === undefined ? {} : { locked: state.lockfile }),
    });

    const pending = await materialize(state.root, resolved);

    await atomicWrite(
        join(state.root, "manifest.json"),
        serializeManifest(updated),
    );

    await writeLockfile(state.root, resolved);

    reportPendingScripts(pending);

    return options.name;
}

/** Adds a live local package selected by the enclosing monorepo manifest. */
export async function addWorkspace(name: string): Promise<string> {
    const state = await readProject();

    if (state.manifest.dependencies[name] !== undefined) {
        throw new WizError(`Dependency already exists: ${name}`);
    }

    const project = await discoverWorkspaces(state.root);

    if (!project.packages.has(name)) {
        throw new WizError(`Unknown workspace package: ${name}`);
    }

    const updated: Manifest = {
        ...state.manifest,
        dependencies: {
            ...state.manifest.dependencies,
            [name]: { workspace: "*" },
        },
    };

    const resolved = await resolveDependencies(updated, {
        home: wizHome(),
        baseDirectory: state.root,
        ...(state.lockfile === undefined ? {} : { locked: state.lockfile }),
    });

    const pending = await materialize(state.root, resolved);

    await atomicWrite(
        join(state.root, "manifest.json"),
        serializeManifest(updated),
    );

    await writeLockfile(state.root, resolved);

    reportPendingScripts(pending);

    return name;
}

async function installProject(
    state: Awaited<ReturnType<typeof readProject>>,
    frozen: boolean,
): Promise<void> {
    if (frozen && state.lockfile === undefined) {
        throw new WizError("--frozen-lockfile requires wiz.lock.json");
    }

    const lockfileMatches =
        state.lockfile !== undefined &&
        (await lockMatchesManifest(state.lockfile, state.manifest, state.root));

    if (frozen && !lockfileMatches) {
        throw new WizError(
            "Manifest and lockfile differ under --frozen-lockfile",
        );
    }

    const resolved = lockfileMatches
        ? state.lockfile
        : await resolveDependencies(state.manifest, {
              home: wizHome(),
              baseDirectory: state.root,
              ...(state.lockfile === undefined
                  ? {}
                  : { locked: state.lockfile }),
          });

    if (resolved === undefined) {
        throw new WizError("Unable to resolve the dependency graph");
    }

    await ensurePackagesStored(resolved.packages);

    const pending = await materialize(state.root, resolved);

    if (!frozen) {
        await writeLockfile(state.root, resolved);
    }

    reportPendingScripts(pending);
}

/** Installs one package, or every package when invoked at a monorepo root. */
export async function install(frozen: boolean): Promise<void> {
    const state = await readProject();

    await installProject(state, frozen);

    if (state.manifest.workspaces === undefined) {
        return;
    }

    const project = await discoverWorkspaces(state.root);

    const packages = [...project.packages.values()].sort((left, right) => {
        return left.name.localeCompare(right.name);
    });

    for (const workspacePackage of packages) {
        const lockfile = await readLockfile(workspacePackage.root);

        try {
            await installProject(
                {
                    root: workspacePackage.root,
                    manifest: workspacePackage.manifest,
                    ...(lockfile === undefined ? {} : { lockfile }),
                },
                frozen,
            );
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);

            throw new WizError(
                `Failed to install workspace ${workspacePackage.name}: ${reason}`,
            );
        }
    }
}

export async function update(name?: string): Promise<void> {
    const state = await readProject();

    if (name !== undefined && state.manifest.dependencies[name] === undefined) {
        throw new WizError(`Unknown direct dependency: ${name}`);
    }

    const resolved = await resolveDependencies(state.manifest, {
        home: wizHome(),
        baseDirectory: state.root,
        ...(state.lockfile === undefined ? {} : { locked: state.lockfile }),
        update: name === undefined ? "all" : new Set([name]),
    });

    const pending = await materialize(state.root, resolved);

    await writeLockfile(state.root, resolved);

    reportPendingScripts(pending);
}

export async function remove(name: string): Promise<void> {
    const state = await readProject();

    if (state.manifest.dependencies[name] === undefined) {
        throw new WizError(`Unknown direct dependency: ${name}`);
    }

    const dependencies = { ...state.manifest.dependencies };

    delete dependencies[name];

    const updated: Manifest = {
        ...state.manifest,
        dependencies,
    };

    const resolved = await resolveDependencies(updated, {
        home: wizHome(),
        baseDirectory: state.root,
        ...(state.lockfile === undefined ? {} : { locked: state.lockfile }),
    });

    await materialize(state.root, resolved);

    await atomicWrite(
        join(state.root, "manifest.json"),
        serializeManifest(updated),
    );

    await writeLockfile(state.root, resolved);
}

async function packagesWithPostinstall(
    projectRoot: string,
    packages: readonly LockedPackage[],
): Promise<LockedPackage[]> {
    const result: LockedPackage[] = [];

    for (const item of packages) {
        const root =
            item.workspacePath === undefined
                ? storePath(wizHome(), item.repo, item.commit)
                : await resolveWorkspacePackagePath(
                      projectRoot,
                      item.workspacePath,
                      item.name,
                  );

        const manifest = await readManifest(root);

        if (manifest.scripts.postinstall !== undefined) {
            result.push(item);
        }
    }

    return result;
}

function matchesApprovalSelector(
    item: LockedPackage,
    selector: string,
): boolean {
    if (item.id === selector || item.name === selector) {
        return true;
    }

    return `${item.name}@${item.commit}`.startsWith(selector);
}

function selectApprovalPackage(
    packages: readonly LockedPackage[],
    selector: string,
): LockedPackage {
    const matches = packages.filter((item) => {
        return matchesApprovalSelector(item, selector);
    });

    if (matches.length === 0) {
        throw new WizError(`No postinstall script found for ${selector}`);
    }

    if (matches.length > 1) {
        const packageIds = matches
            .map((item) => {
                return item.id;
            })
            .join(", ");

        throw new WizError(
            `Approval selector ${selector} is ambiguous: ${packageIds}`,
        );
    }

    const item = matches[0];

    if (item === undefined) {
        throw new WizError(`No postinstall script found for ${selector}`);
    }

    return item;
}

/** Approves exact locked revisions and rebuilds their isolated instances. */
export async function approve(selectors: readonly string[]): Promise<string[]> {
    const state = await readProject();

    if (state.lockfile === undefined) {
        throw new WizError("Install dependencies before approving scripts");
    }

    const scriptPackages = await packagesWithPostinstall(
        state.root,
        state.lockfile.packages,
    );

    const approvals = await readScriptApprovals(state.root);

    if (selectors.length === 0) {
        return scriptPackages
            .filter((item) => {
                return !isScriptApproved(
                    approvals,
                    item.id,
                    item.repo,
                    item.commit,
                );
            })
            .map((item) => {
                return item.id;
            });
    }

    const packages = { ...approvals.packages };

    const approved: string[] = [];

    for (const selector of selectors) {
        const item = selectApprovalPackage(scriptPackages, selector);

        packages[item.id] = {
            repo: item.repo,
            commit: item.commit,
        };

        approved.push(item.id);
    }

    await writeScriptApprovals(state.root, {
        approvalVersion: 1,
        packages,
    });

    await materialize(state.root, state.lockfile);

    return approved;
}
