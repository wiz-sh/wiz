import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeRepo } from "../dependencies/git.ts";
import type { LockedPackage, Lockfile, Manifest } from "../types.ts";
import { isCodedError, WizError } from "../utils/errors.ts";
import { atomicWrite } from "../utils/filesystem.ts";
import {
    assertJsonKeys,
    type JsonValue,
    parseJson,
    requireJsonObject,
    serializeJson,
} from "../utils/json.ts";
import { safeRelativePath } from "../utils/paths.ts";
import { discoverWorkspaces } from "./workspaces.ts";

function requiredString(value: JsonValue | undefined, label: string): string {
    if (typeof value !== "string") {
        throw new WizError(`${label} must be a string`);
    }

    return value;
}

function mapping(
    value: JsonValue | undefined,
    label: string,
): Record<string, string> {
    const source = requireJsonObject(value ?? {}, label);

    const result: Record<string, string> = {};

    for (const [key, item] of Object.entries(source)) {
        if (typeof item !== "string") {
            throw new WizError(`${label}.${key} must be a string`);
        }

        result[key] = item;
    }

    return result;
}

export function validateLockfile(value: JsonValue): Lockfile {
    const root = requireJsonObject(value, "lockfile");

    assertJsonKeys(
        root,
        ["lockfileVersion", "rootDependencies", "packages"],
        "lockfile",
    );

    if (root.lockfileVersion !== 1 && root.lockfileVersion !== 2) {
        throw new WizError(
            "Unsupported or missing lockfileVersion; expected 1 or 2",
        );
    }

    const rootDependencies = mapping(root.rootDependencies, "rootDependencies");

    if (!Array.isArray(root.packages)) {
        throw new WizError("lockfile packages must be an array of objects");
    }

    const seen = new Set<string>();

    const packages: LockedPackage[] = root.packages.map((raw, index) => {
        const item = requireJsonObject(raw, `packages[${index}]`);

        assertJsonKeys(
            item,
            [
                "id",
                "name",
                "repo",
                "requestedBranch",
                "resolvedBranch",
                "commit",
                "direct",
                "dependencies",
                "workspacePath",
                "localPath",
                "source",
                "archive",
            ],
            `packages[${index}]`,
        );

        const id = requiredString(item.id, `packages[${index}].id`);

        const name = requiredString(item.name, `packages[${index}].name`);

        const repo = requiredString(item.repo, `packages[${index}].repo`);

        const commit = requiredString(item.commit, `packages[${index}].commit`);

        let workspacePath: string | undefined;

        let localPath: string | undefined;

        if (item.workspacePath !== undefined) {
            workspacePath = safeRelativePath(
                item.workspacePath,
                `packages[${index}].workspacePath`,
            );

            if (
                workspacePath === "." ||
                repo !== `workspace:${workspacePath}` ||
                commit !== "workspace"
            ) {
                throw new WizError(
                    `packages[${index}] has an invalid workspace lock entry`,
                );
            }
        }

        if (item.localPath !== undefined) {
            localPath = requiredString(
                item.localPath,
                `packages[${index}].localPath`,
            );
        }

        let source: LockedPackage["source"];

        if (item.source !== undefined) {
            const rawSource = requireJsonObject(
                item.source,
                `packages[${index}].source`,
            );

            const type = requiredString(
                rawSource.type,
                `packages[${index}].source.type`,
            );

            if (type === "registry") {
                assertJsonKeys(
                    rawSource,
                    ["type", "registry", "package", "version"],
                    `packages[${index}].source`,
                );

                source = {
                    type,
                    registry: requiredString(
                        rawSource.registry,
                        `packages[${index}].source.registry`,
                    ),
                    package: requiredString(
                        rawSource.package,
                        `packages[${index}].source.package`,
                    ),
                    version: requiredString(
                        rawSource.version,
                        `packages[${index}].source.version`,
                    ),
                };
            } else if (type === "git") {
                assertJsonKeys(
                    rawSource,
                    ["type", "repository", "commit"],
                    `packages[${index}].source`,
                );

                source = {
                    type,
                    repository: requiredString(
                        rawSource.repository,
                        `packages[${index}].source.repository`,
                    ),
                    commit: requiredString(
                        rawSource.commit,
                        `packages[${index}].source.commit`,
                    ),
                };
            } else if (type === "local") {
                source = {
                    type,
                    path: requiredString(
                        rawSource.path,
                        `packages[${index}].source.path`,
                    ),
                };
            } else {
                throw new WizError(
                    `packages[${index}].source.type is unsupported`,
                );
            }
        }

        let archive: LockedPackage["archive"];

        if (item.archive !== undefined) {
            const rawArchive = requireJsonObject(
                item.archive,
                `packages[${index}].archive`,
            );

            assertJsonKeys(
                rawArchive,
                ["url", "integrity", "size"],
                `packages[${index}].archive`,
            );

            if (
                typeof rawArchive.size !== "number" ||
                !Number.isSafeInteger(rawArchive.size) ||
                rawArchive.size < 0
            ) {
                throw new WizError(
                    `packages[${index}].archive.size must be a nonnegative safe integer`,
                );
            }

            archive = {
                url: requiredString(
                    rawArchive.url,
                    `packages[${index}].archive.url`,
                ),
                integrity: requiredString(
                    rawArchive.integrity,
                    `packages[${index}].archive.integrity`,
                ),
                size: rawArchive.size,
            };
        }

        if (typeof item.direct !== "boolean") {
            throw new WizError(`packages[${index}].direct must be boolean`);
        }

        for (const key of ["requestedBranch", "resolvedBranch"] as const) {
            if (item[key] !== undefined && typeof item[key] !== "string") {
                throw new WizError(
                    `packages[${index}].${key} must be a string`,
                );
            }
        }

        if (seen.has(id)) {
            throw new WizError(`Duplicate package id: ${id}`);
        }

        seen.add(id);

        return {
            id,
            name,
            repo,
            commit,
            direct: item.direct,
            dependencies: mapping(
                item.dependencies,
                `packages[${index}].dependencies`,
            ),
            ...(typeof item.requestedBranch === "string"
                ? { requestedBranch: item.requestedBranch }
                : {}),
            ...(typeof item.resolvedBranch === "string"
                ? { resolvedBranch: item.resolvedBranch }
                : {}),
            ...(workspacePath === undefined ? {} : { workspacePath }),
            ...(localPath === undefined ? {} : { localPath }),
            ...(source === undefined ? {} : { source }),
            ...(archive === undefined ? {} : { archive }),
        };
    });

    for (const [name, id] of Object.entries(rootDependencies)) {
        if (!seen.has(id)) {
            throw new WizError(
                `Missing package reference for root dependency ${name}: ${id}`,
            );
        }
    }

    for (const item of packages) {
        for (const [name, id] of Object.entries(item.dependencies)) {
            if (!seen.has(id)) {
                throw new WizError(
                    `Missing package reference for ${item.id} dependency ${name}: ${id}`,
                );
            }
        }
    }

    const byId = new Map(
        packages.map((item) => {
            return [item.id, item] as const;
        }),
    );

    const visiting = new Set<string>();

    const reachable = new Set<string>();

    const visit = (id: string, trace: readonly string[]): void => {
        if (visiting.has(id)) {
            throw new WizError(
                `Lockfile dependency cycle: ${[...trace, id].join(" -> ")}`,
            );
        }

        if (reachable.has(id)) {
            return;
        }

        const item = byId.get(id);

        if (item === undefined) {
            return;
        }

        visiting.add(id);

        for (const dependency of Object.values(item.dependencies)) {
            visit(dependency, [...trace, id]);
        }

        visiting.delete(id);

        reachable.add(id);
    };

    for (const id of Object.values(rootDependencies)) {
        visit(id, []);
    }

    const unreachable = packages.find((item) => {
        return !reachable.has(item.id);
    });

    if (unreachable !== undefined) {
        throw new WizError(`Unreachable package entry: ${unreachable.id}`);
    }

    return {
        lockfileVersion: root.lockfileVersion,
        rootDependencies,
        packages,
    };
}

export function parseLockfile(text: string): Lockfile {
    return validateLockfile(parseJson(text, "wiz.lock.json"));
}

export function serializeLockfile(lockfile: Lockfile): string {
    const sorted = (
        value: Readonly<Record<string, string>>,
    ): Record<string, string> => {
        return Object.fromEntries(
            Object.entries(value).sort(([a], [b]) => {
                return a.localeCompare(b);
            }),
        );
    };

    return serializeJson({
        lockfileVersion: lockfile.lockfileVersion,
        rootDependencies: sorted(lockfile.rootDependencies),
        packages: [...lockfile.packages]
            .sort((a, b) => {
                return a.id.localeCompare(b.id);
            })
            .map((item) => {
                return {
                    ...item,
                    dependencies: sorted(item.dependencies),
                };
            }),
    });
}

export async function readLockfile(
    root: string,
): Promise<Lockfile | undefined> {
    try {
        return parseLockfile(
            await readFile(join(root, "wiz.lock.json"), "utf8"),
        );
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

export async function writeLockfile(
    root: string,
    lockfile: Lockfile,
): Promise<void> {
    await atomicWrite(join(root, "wiz.lock.json"), serializeLockfile(lockfile));
}

export async function lockMatchesManifest(
    lockfile: Lockfile,
    manifest: Manifest,
    baseDirectory = process.cwd(),
): Promise<boolean> {
    const names = Object.keys(manifest.dependencies).sort();

    if (
        names.join("\0") !==
        Object.keys(lockfile.rootDependencies).sort().join("\0")
    ) {
        return false;
    }

    const byId = new Map(
        lockfile.packages.map((item) => {
            return [item.id, item] as const;
        }),
    );

    const hasWorkspaceDependency = Object.values(manifest.dependencies).some(
        (spec) => {
            return "workspace" in spec;
        },
    );

    const workspaceProject = hasWorkspaceDependency
        ? await discoverWorkspaces(baseDirectory)
        : undefined;

    return names.every((name) => {
        const spec = manifest.dependencies[name];

        const item = byId.get(lockfile.rootDependencies[name] ?? "");

        if (spec === undefined || item === undefined) {
            return false;
        }

        if ("workspace" in spec) {
            const workspacePackage = workspaceProject?.packages.get(name);

            return (
                spec.workspace === "*" &&
                workspacePackage !== undefined &&
                item.workspacePath === workspacePackage.relativePath
            );
        }

        if ("version" in spec) {
            return (
                item.source?.type === "registry" && item.source.package === name
            );
        }

        if ("path" in spec) {
            return item.source?.type === "local";
        }

        if (!("repo" in spec)) {
            return false;
        }

        return (
            item.workspacePath === undefined &&
            item.repo === normalizeRepo(spec.repo, baseDirectory) &&
            item.requestedBranch === spec.branch &&
            (spec.commit === undefined || item.commit.startsWith(spec.commit))
        );
    });
}
