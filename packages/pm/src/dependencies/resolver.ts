import { join, relative, resolve } from "node:path";
import { readManifest } from "../project/manifest.ts";
import {
    discoverWorkspaces,
    type WorkspaceProject,
} from "../project/workspaces.ts";
import type {
    DependencySpec,
    LockedPackage,
    Lockfile,
    Manifest,
} from "../types.ts";
import { WizError } from "../utils/errors.ts";
import { normalizeRepo, resolveGit } from "./git.ts";
import {
    ensureRegistryStored,
    registryPackageFromLock,
    resolveRegistryPackage,
} from "./registry.ts";
import { ensureStored, repositoryHash } from "./store.ts";

export interface ResolveOptions {
    home: string;
    baseDirectory: string;
    locked?: Lockfile;
    update?: ReadonlySet<string> | "all";
}

function isWorkspaceDependency(
    spec: DependencySpec,
): spec is Extract<DependencySpec, { workspace: string }> {
    return "workspace" in spec;
}

function isRegistryDependency(
    spec: DependencySpec,
): spec is Extract<DependencySpec, { version: string }> {
    return "version" in spec;
}

function isLocalDependency(
    spec: DependencySpec,
): spec is Extract<DependencySpec, { path: string }> {
    return "path" in spec;
}

/** Resolves Git and local workspace packages into one exact dependency graph. */
export async function resolveDependencies(
    manifest: Manifest,
    options: ResolveOptions,
): Promise<Lockfile> {
    const packages = new Map<string, LockedPackage>();

    const lockedPackages = options.locked?.packages ?? [];

    const visiting: Array<{ id: string; name: string }> = [];

    const rootDependencies: Record<string, string> = {};

    let workspaceProject: Promise<WorkspaceProject> | undefined;

    function workspaces(): Promise<WorkspaceProject> {
        workspaceProject ??= discoverWorkspaces(options.baseDirectory);

        return workspaceProject;
    }

    function beginVisit(id: string, name: string): LockedPackage | undefined {
        const cycleIndex = visiting.findIndex((entry) => {
            return entry.id === id;
        });

        if (cycleIndex >= 0) {
            const cycle = visiting.slice(cycleIndex).map((entry) => {
                return entry.name;
            });

            throw new WizError(
                `Dependency cycle: ${[...cycle, name].join(" -> ")}`,
            );
        }

        return packages.get(id);
    }

    async function visitWorkspace(
        name: string,
        selector: string,
        direct: boolean,
    ): Promise<string> {
        if (selector !== "*") {
            throw new WizError(
                `Unsupported workspace selector for ${name}: ${selector}; use "*"`,
            );
        }

        const project = await workspaces();

        const workspacePackage = project.packages.get(name);

        if (workspacePackage === undefined) {
            throw new WizError(
                `Workspace dependency ${name} is not matched by the root workspaces patterns`,
            );
        }

        const id = `${name}@workspace:${workspacePackage.relativePath}`;

        const existing = beginVisit(id, name);

        if (existing !== undefined) {
            if (direct && !existing.direct) {
                packages.set(id, { ...existing, direct: true });
            }

            return id;
        }

        visiting.push({ id, name });

        const dependencies: Record<string, string> = {};

        packages.set(id, {
            id,
            name,
            repo: `workspace:${workspacePackage.relativePath}`,
            commit: "workspace",
            direct,
            dependencies,
            workspacePath: workspacePackage.relativePath,
        });

        for (const [childName, childSpec] of Object.entries(
            workspacePackage.manifest.dependencies,
        )) {
            dependencies[childName] = await visit(
                childName,
                childSpec,
                false,
                workspacePackage.root,
            );
        }

        visiting.pop();

        return id;
    }

    async function visitGit(
        name: string,
        spec: Extract<DependencySpec, { repo: string }>,
        direct: boolean,
        containingDirectory: string,
    ): Promise<string> {
        const normalizedRepo = normalizeRepo(spec.repo, containingDirectory);

        const locked = lockedPackages.find((item) => {
            return (
                item.workspacePath === undefined &&
                item.name === name &&
                item.repo === normalizedRepo &&
                item.requestedBranch === spec.branch &&
                (spec.commit === undefined ||
                    item.commit.startsWith(spec.commit))
            );
        });

        const refresh =
            options.update === "all" || options.update?.has(name) === true;

        const resolved =
            locked !== undefined && !refresh
                ? {
                      repo: locked.repo,
                      commit: locked.commit,
                      ...(locked.resolvedBranch === undefined
                          ? {}
                          : { branch: locked.resolvedBranch }),
                  }
                : await resolveGit(spec, containingDirectory);

        const id = `${name}@${repositoryHash(resolved.repo)}:${resolved.commit}`;

        const existing = beginVisit(id, name);

        if (existing !== undefined) {
            if (direct && !existing.direct) {
                packages.set(id, { ...existing, direct: true });
            }

            return id;
        }

        visiting.push({ id, name });

        const root = await ensureStored(
            options.home,
            resolved.repo,
            resolved.commit,
        );

        const dependencyManifest = await readManifest(root);

        if (dependencyManifest.package.name !== name) {
            throw new WizError(
                `Dependency ${name} contains package ${dependencyManifest.package.name}`,
            );
        }

        const dependencies: Record<string, string> = {};

        packages.set(id, {
            id,
            name,
            repo: resolved.repo,
            commit: resolved.commit,
            direct,
            dependencies,
            ...(spec.branch === undefined
                ? {}
                : { requestedBranch: spec.branch }),
            ...(resolved.branch === undefined
                ? {}
                : { resolvedBranch: resolved.branch }),
        });

        for (const [childName, childSpec] of Object.entries(
            dependencyManifest.dependencies,
        )) {
            dependencies[childName] = await visit(
                childName,
                childSpec,
                false,
                root,
            );
        }

        visiting.pop();

        return id;
    }

    async function visitRegistry(
        name: string,
        spec: Extract<DependencySpec, { version: string }>,
        direct: boolean,
    ): Promise<string> {
        const locked = lockedPackages.find((item) => {
            return (
                item.name === name &&
                item.source?.type === "registry" &&
                item.archive !== undefined
            );
        });

        const refresh =
            options.update === "all" || options.update?.has(name) === true;

        const resolved =
            locked !== undefined &&
            locked.source?.type === "registry" &&
            locked.archive !== undefined &&
            !refresh
                ? await registryPackageFromLock({
                      registry: locked.source.registry,
                      name: locked.source.package,
                      version: locked.source.version,
                      archiveUrl: locked.archive.url,
                      integrity: locked.archive.integrity,
                      size: locked.archive.size,
                  })
                : await resolveRegistryPackage(name, spec, manifest.registries);

        const id = `${name}@registry:${repositoryHash(resolved.registry)}:${resolved.version}`;

        const existing = beginVisit(id, name);

        if (existing !== undefined) {
            if (direct && !existing.direct) {
                packages.set(id, { ...existing, direct: true });
            }

            return id;
        }

        visiting.push({ id, name });

        const root = await ensureRegistryStored(options.home, resolved);

        const dependencyManifest = await readManifest(root);

        if (dependencyManifest.package.name !== name) {
            throw new WizError(
                `Registry dependency ${name} contains package ${dependencyManifest.package.name}`,
            );
        }

        const dependencies: Record<string, string> = {};

        packages.set(id, {
            id,
            name,
            repo: `registry:${resolved.registry}/${name}`,
            commit: resolved.version,
            direct,
            dependencies,
            source: {
                type: "registry",
                registry: resolved.registry,
                package: name,
                version: resolved.version,
            },
            archive: {
                url: resolved.archiveUrl,
                integrity: resolved.integrity,
                size: resolved.size,
            },
        });

        for (const [childName, childSpec] of Object.entries(
            dependencyManifest.dependencies,
        )) {
            dependencies[childName] = await visit(
                childName,
                childSpec,
                false,
                root,
            );
        }

        visiting.pop();

        return id;
    }

    async function visitLocal(
        name: string,
        spec: Extract<DependencySpec, { path: string }>,
        direct: boolean,
        containingDirectory: string,
    ): Promise<string> {
        const root = resolve(containingDirectory, spec.path);

        const localPath = relative(options.baseDirectory, root).replaceAll(
            "\\",
            "/",
        );

        const id = `${name}@local:${localPath}`;

        const existing = beginVisit(id, name);

        if (existing !== undefined) {
            return id;
        }

        visiting.push({ id, name });

        const dependencyManifest = await readManifest(root);

        if (dependencyManifest.package.name !== name) {
            throw new WizError(
                `Local dependency ${name} contains package ${dependencyManifest.package.name}`,
            );
        }

        const dependencies: Record<string, string> = {};

        packages.set(id, {
            id,
            name,
            repo: `local:${localPath}`,
            commit: "local",
            direct,
            dependencies,
            localPath,
            source: { type: "local", path: localPath },
        });

        for (const [childName, childSpec] of Object.entries(
            dependencyManifest.dependencies,
        )) {
            dependencies[childName] = await visit(
                childName,
                childSpec,
                false,
                root,
            );
        }

        visiting.pop();

        return id;
    }

    async function visit(
        name: string,
        spec: DependencySpec,
        direct: boolean,
        containingDirectory: string,
    ): Promise<string> {
        if (isWorkspaceDependency(spec)) {
            return visitWorkspace(name, spec.workspace, direct);
        }

        if (isRegistryDependency(spec)) {
            return visitRegistry(name, spec, direct);
        }

        if (isLocalDependency(spec)) {
            return visitLocal(name, spec, direct, containingDirectory);
        }

        if (!("repo" in spec)) {
            throw new WizError(
                `Dependency source resolution is not available yet for ${name}`,
            );
        }

        return visitGit(name, spec, direct, containingDirectory);
    }

    for (const [name, spec] of Object.entries(manifest.dependencies)) {
        rootDependencies[name] = await visit(
            name,
            spec,
            true,
            options.baseDirectory,
        );
    }

    return {
        lockfileVersion: [...packages.values()].some((item) => {
            return (
                item.source?.type === "registry" ||
                item.source?.type === "local"
            );
        })
            ? 2
            : 1,
        rootDependencies,
        packages: [...packages.values()],
    };
}

export function modulePath(root: string, name: string): string {
    return join(root, "wiz_modules", name);
}

/** Returns the isolated on-disk instance for one exact Git revision. */
export function instancePath(modulesRoot: string, item: LockedPackage): string {
    return join(
        modulesRoot,
        ".wiz",
        `${repositoryHash(item.repo)}-${item.commit}`,
    );
}
