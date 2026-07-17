import { join } from "node:path";
import { instancePath, modulePath } from "../dependencies/resolver.ts";
import { readProjectLinks } from "../global/links.ts";
import {
    findProjectRoot,
    findProjectRootIfPresent,
} from "../project/discovery.ts";
import { readLockfile } from "../project/lockfile.ts";
import { readManifest } from "../project/manifest.ts";
import { resolveWorkspacePackagePath } from "../project/workspaces.ts";
import type { LockedPackage, Lockfile, Manifest } from "../types.ts";
import { WizError } from "../utils/errors.ts";

export interface ProjectState {
    root: string;
    manifest: Manifest;
    lockfile?: Lockfile;
}

export interface PackageInfo {
    root: string;
    manifest: Manifest;
    item?: LockedPackage;
    projectRoot: string;
}

async function readProjectAtRoot(root: string): Promise<ProjectState> {
    const manifest = await readManifest(root);

    const lockfile = await readLockfile(root);

    if (lockfile === undefined) {
        return { root, manifest };
    }

    return { root, manifest, lockfile };
}

export async function readProject(): Promise<ProjectState> {
    const start = process.env.WIZ_PROJECT_ROOT ?? process.cwd();

    const root = await findProjectRoot(start);

    return readProjectAtRoot(root);
}

export async function readProjectIfPresent(): Promise<
    ProjectState | undefined
> {
    const start = process.env.WIZ_PROJECT_ROOT ?? process.cwd();

    const root = await findProjectRootIfPresent(start);

    if (root === undefined) {
        return undefined;
    }

    return readProjectAtRoot(root);
}

function selectInstalledPackage(
    name: string,
    state: ProjectState,
): LockedPackage {
    const packages = state.lockfile?.packages ?? [];

    const packagesById = new Map(
        packages.map((item) => {
            return [item.id, item] as const;
        }),
    );

    const contextualPackageId = process.env.WIZ_PACKAGE_ID;

    let contextualDependencyId: string | undefined;

    if (contextualPackageId !== undefined) {
        contextualDependencyId =
            packagesById.get(contextualPackageId)?.dependencies[name];
    }

    const rootDependencyId = state.lockfile?.rootDependencies[name];

    const exactContextMatch = packagesById.get(
        contextualDependencyId ?? rootDependencyId ?? "",
    );

    const nameMatches = packages.filter((item) => {
        return item.name === name;
    });

    if (exactContextMatch !== undefined) {
        return exactContextMatch;
    }

    if (nameMatches.length === 1 && nameMatches[0] !== undefined) {
        return nameMatches[0];
    }

    if (nameMatches.length > 1) {
        const revisions = nameMatches
            .map((item) => {
                return item.id;
            })
            .join(", ");

        throw new WizError(
            `Package ${name} has multiple installed revisions: ${revisions}`,
        );
    }

    throw new WizError(`Package is not installed: ${name}`);
}

export async function packageInfo(name?: string): Promise<PackageInfo> {
    const state = await readProject();

    if (name === undefined || name === state.manifest.package.name) {
        return {
            root: state.root,
            manifest: state.manifest,
            projectRoot: state.root,
        };
    }

    const linked = (await readProjectLinks(state.root))[name];

    if (linked !== undefined) {
        return {
            root: linked.path,
            manifest: await readManifest(linked.path),
            projectRoot: state.root,
        };
    }

    const item = selectInstalledPackage(name, state);

    const rootDependencyId = state.lockfile?.rootDependencies[name];

    let root: string;

    if (item.workspacePath !== undefined) {
        root = await resolveWorkspacePackagePath(
            state.root,
            item.workspacePath,
            item.name,
        );
    } else if (rootDependencyId === item.id) {
        root = modulePath(state.root, name);
    } else {
        root = instancePath(join(state.root, "wiz_modules"), item);
    }

    return {
        root,
        manifest: await readManifest(root),
        item,
        projectRoot: state.root,
    };
}
