import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import type { Manifest } from "../types.ts";
import { isCodedError, WizError } from "../utils/errors.ts";
import { readManifest } from "./manifest.ts";

export interface WorkspacePackage {
    name: string;
    root: string;
    relativePath: string;
    manifest: Manifest;
}

export interface WorkspaceProject {
    root: string;
    manifest: Manifest;
    packages: ReadonlyMap<string, WorkspacePackage>;
}

async function manifestIfPresent(root: string): Promise<Manifest | undefined> {
    try {
        return await readManifest(root);
    } catch (err) {
        if (
            err instanceof Error &&
            isCodedError(err) &&
            err.code === "ENOENT"
        ) {
            return undefined;
        }

        throw err;
    }
}

/** Finds the outer manifest that owns workspace patterns for the current path. */
export async function findWorkspaceRootIfPresent(
    start = process.cwd(),
): Promise<string | undefined> {
    let current = resolve(start);

    while (true) {
        const manifest = await manifestIfPresent(current);

        if (manifest?.workspaces !== undefined) {
            return realpath(current);
        }

        const parent = dirname(current);

        if (parent === current || current === parse(current).root) {
            return undefined;
        }

        current = parent;
    }
}

export async function findWorkspaceRoot(
    start = process.cwd(),
): Promise<string> {
    const root = await findWorkspaceRootIfPresent(start);

    if (root === undefined) {
        throw new WizError(
            "No Wiz monorepo found; add workspaces to the root manifest.json",
        );
    }

    return root;
}

function assertInsideWorkspaceRoot(
    workspaceRoot: string,
    packageRoot: string,
): string {
    const path = relative(workspaceRoot, packageRoot);

    if (
        path.length === 0 ||
        path === ".." ||
        path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
        isAbsolute(path)
    ) {
        throw new WizError(
            `Workspace package escapes the monorepo root: ${packageRoot}`,
        );
    }

    return path.split("\\").join("/");
}

async function matchedManifestPaths(
    root: string,
    patterns: readonly string[],
): Promise<string[]> {
    const paths = new Set<string>();

    for (const pattern of patterns) {
        const glob = new Bun.Glob(`${pattern}/manifest.json`);

        for await (const path of glob.scan({
            cwd: root,
            dot: false,
            onlyFiles: true,
        })) {
            paths.add(path);
        }
    }

    return [...paths].sort((left, right) => {
        return left.localeCompare(right);
    });
}

/** Discovers and validates every package owned by the nearest monorepo. */
export async function discoverWorkspaces(
    start = process.cwd(),
): Promise<WorkspaceProject> {
    const root = await findWorkspaceRoot(start);

    const canonicalRoot = await realpath(root);

    const manifest = await readManifest(canonicalRoot);

    const packages = new Map<string, WorkspacePackage>();

    const paths = await matchedManifestPaths(
        canonicalRoot,
        manifest.workspaces ?? [],
    );

    for (const manifestPath of paths) {
        const packageRoot = await realpath(
            dirname(join(canonicalRoot, manifestPath)),
        );

        const relativePath = assertInsideWorkspaceRoot(
            canonicalRoot,
            packageRoot,
        );

        const packageManifest = await readManifest(packageRoot);

        const name = packageManifest.package.name;

        const existing = packages.get(name);

        if (existing !== undefined) {
            throw new WizError(
                `Duplicate workspace package ${name}: ${existing.relativePath} and ${relativePath}`,
            );
        }

        packages.set(name, {
            name,
            root: packageRoot,
            relativePath,
            manifest: packageManifest,
        });
    }

    return {
        root: canonicalRoot,
        manifest,
        packages,
    };
}

/** Resolves a lockfile workspace path and rejects stale or forged entries. */
export async function resolveWorkspacePackagePath(
    start: string,
    workspacePath: string,
    expectedName: string,
): Promise<string> {
    const project = await discoverWorkspaces(start);

    const workspacePackage = project.packages.get(expectedName);

    if (
        workspacePackage === undefined ||
        workspacePackage.relativePath !== workspacePath
    ) {
        throw new WizError(
            `Workspace lock entry is stale for ${expectedName}; run wiz install`,
        );
    }

    return workspacePackage.root;
}
