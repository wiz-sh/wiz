import { cp, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { instancePath } from "../dependencies/resolver.ts";
import { replaceSymlink, storePath } from "../dependencies/store.ts";
import { applyProjectLinks } from "../global/links.ts";
import { isScriptApproved, readScriptApprovals } from "../project/approvals.ts";
import { wizHome } from "../project/discovery.ts";
import { readManifest } from "../project/manifest.ts";
import { resolveWorkspacePackagePath } from "../project/workspaces.ts";
import {
    lifecycleEnvironment,
    runLifecycleScript,
} from "../scripts/lifecycle.ts";
import type { LockedPackage, Lockfile } from "../types.ts";
import { isCodedError, WizError } from "../utils/errors.ts";

type PackageInstances = ReadonlyMap<string, string>;

function postinstallOrder(lockfile: Lockfile): LockedPackage[] {
    const packagesById = new Map(
        lockfile.packages.map((item) => {
            return [item.id, item] as const;
        }),
    );

    const visited = new Set<string>();

    const ordered: LockedPackage[] = [];

    function visit(item: LockedPackage): void {
        if (visited.has(item.id)) {
            return;
        }

        visited.add(item.id);

        for (const dependencyId of Object.values(item.dependencies)) {
            const dependency = packagesById.get(dependencyId);

            if (dependency !== undefined) {
                visit(dependency);
            }
        }

        ordered.push(item);
    }

    for (const item of lockfile.packages) {
        visit(item);
    }

    return ordered;
}

async function createPackageInstances(
    projectRoot: string,
    temporaryModules: string,
    lockfile: Lockfile,
): Promise<PackageInstances> {
    const instances = new Map<string, string>();

    await mkdir(join(temporaryModules, ".wiz"), { recursive: true });

    for (const item of lockfile.packages) {
        if (item.workspacePath !== undefined) {
            const workspaceRoot = await resolveWorkspacePackagePath(
                projectRoot,
                item.workspacePath,
                item.name,
            );

            await mkdir(join(workspaceRoot, "wiz_modules"), {
                recursive: true,
            });

            instances.set(item.id, workspaceRoot);

            continue;
        }

        if (item.localPath !== undefined) {
            const localRoot = join(projectRoot, item.localPath);

            await mkdir(join(localRoot, "wiz_modules"), { recursive: true });

            instances.set(item.id, localRoot);

            continue;
        }

        const source = storePath(wizHome(), item.repo, item.commit);

        const destination = instancePath(temporaryModules, item);

        await cp(source, destination, { recursive: true });

        await mkdir(join(destination, "wiz_modules"), { recursive: true });

        instances.set(item.id, destination);
    }

    return instances;
}

function requireInstance(
    instances: PackageInstances,
    packageId: string,
): string {
    const instance = instances.get(packageId);

    if (instance === undefined) {
        throw new WizError(`Missing package instance: ${packageId}`);
    }

    return instance;
}

async function linkPackageDependencies(
    lockfile: Lockfile,
    instances: PackageInstances,
): Promise<void> {
    for (const item of lockfile.packages) {
        const packageRoot = requireInstance(instances, item.id);

        for (const [name, dependencyId] of Object.entries(item.dependencies)) {
            const dependencyRoot = requireInstance(instances, dependencyId);

            const link = join(packageRoot, "wiz_modules", name);

            const target = relative(dirname(link), dependencyRoot);

            await replaceSymlink(link, target);
        }
    }
}

async function linkRootDependencies(
    temporaryModules: string,
    lockfile: Lockfile,
    instances: PackageInstances,
): Promise<void> {
    for (const [name, packageId] of Object.entries(lockfile.rootDependencies)) {
        const dependencyRoot = requireInstance(instances, packageId);

        const link = join(temporaryModules, name);

        const target = relative(dirname(link), dependencyRoot);

        await replaceSymlink(link, target);
    }
}

async function runApprovedPostinstallScripts(
    projectRoot: string,
    lockfile: Lockfile,
    instances: PackageInstances,
): Promise<LockedPackage[]> {
    const approvals = await readScriptApprovals(projectRoot);

    const pending: LockedPackage[] = [];

    for (const item of postinstallOrder(lockfile)) {
        const packageRoot = requireInstance(instances, item.id);

        const manifest = await readManifest(packageRoot);

        const command = manifest.scripts.postinstall;

        if (command === undefined) {
            continue;
        }

        if (!isScriptApproved(approvals, item.id, item.repo, item.commit)) {
            pending.push(item);

            continue;
        }

        const exitCode = await runLifecycleScript(
            command,
            packageRoot,
            lifecycleEnvironment(projectRoot, packageRoot, item.name, item),
        );

        if (exitCode !== 0) {
            throw new WizError(
                `Postinstall failed for ${item.id} with exit code ${exitCode}`,
            );
        }
    }

    return pending;
}

async function moveExistingModules(
    modules: string,
    previous: string,
): Promise<boolean> {
    try {
        await rename(modules, previous);

        return true;
    } catch (err) {
        if (
            !(err instanceof Error) ||
            !isCodedError(err) ||
            err.code !== "ENOENT"
        ) {
            throw err;
        }

        return false;
    }
}

async function swapModuleTree(
    modules: string,
    temporary: string,
): Promise<void> {
    const previous = `${modules}.old-${crypto.randomUUID()}`;

    const movedPrevious = await moveExistingModules(modules, previous);

    try {
        await rename(temporary, modules);
    } catch (err) {
        if (movedPrevious) {
            await rename(previous, modules);
        }

        throw err;
    }

    await rm(previous, { recursive: true, force: true });
}

/** Builds a complete isolated dependency tree before replacing the active installation. */
export async function materialize(
    projectRoot: string,
    lockfile: Lockfile,
): Promise<LockedPackage[]> {
    const modules = join(projectRoot, "wiz_modules");

    const temporary = `${modules}.tmp-${crypto.randomUUID()}`;

    try {
        const instances = await createPackageInstances(
            projectRoot,
            temporary,
            lockfile,
        );

        await linkPackageDependencies(lockfile, instances);

        await linkRootDependencies(temporary, lockfile, instances);

        await applyProjectLinks(projectRoot, temporary);

        const pending = await runApprovedPostinstallScripts(
            projectRoot,
            lockfile,
            instances,
        );

        await swapModuleTree(modules, temporary);

        return pending;
    } catch (err) {
        await rm(temporary, { recursive: true, force: true });

        throw err;
    }
}
