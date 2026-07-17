import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repositoryHash } from "../dependencies/store.ts";
import { isCodedError, WizError } from "../utils/errors.ts";
import { atomicWrite } from "../utils/filesystem.ts";
import {
    assertJsonKeys,
    type JsonObject,
    parseJson,
    requireJsonObject,
    serializeJson,
} from "../utils/json.ts";
import {
    type GlobalPackageState,
    optionalBranch,
    requiredString,
} from "./registration.ts";

export type {
    GlobalPackageRegistration,
    GlobalPackageState,
} from "./registration.ts";

export function globalPackagePath(
    home: string,
    repo: string,
    commit: string,
): string {
    return join(home, "global", repositoryHash(repo), commit);
}

/** Keeps binless global packages reachable during global store pruning. */
export async function readGlobalPackages(
    home: string,
): Promise<GlobalPackageState> {
    try {
        const parsed = parseJson(
            await readFile(join(home, "global_packages.json"), "utf8"),
            "global_packages.json",
        );

        const root = requireJsonObject(parsed, "global package state");

        assertJsonKeys(
            root,
            ["stateVersion", "packages"],
            "global package state",
        );

        if (root.stateVersion !== 1) {
            throw new WizError("Unsupported global package state version");
        }

        const packages = requireJsonObject(
            root.packages ?? {},
            "global package records",
        );

        return Object.fromEntries(
            Object.entries(packages).map(([id, value]) => {
                const item = requireJsonObject(value, `global package ${id}`);

                assertJsonKeys(
                    item,
                    ["name", "repo", "commit", "branch"],
                    `global package ${id}`,
                );

                return [
                    id,
                    {
                        name: requiredString(
                            item.name,
                            `global package ${id}.name`,
                        ),
                        repo: requiredString(
                            item.repo,
                            `global package ${id}.repo`,
                        ),
                        commit: requiredString(
                            item.commit,
                            `global package ${id}.commit`,
                        ),
                        ...optionalBranch(
                            item.branch,
                            `global package ${id}.branch`,
                        ),
                    },
                ];
            }),
        );
    } catch (err) {
        if (
            err instanceof Error &&
            isCodedError(err) &&
            err.code === "ENOENT"
        ) {
            return {};
        }

        throw err;
    }
}

export async function writeGlobalPackages(
    home: string,
    packages: GlobalPackageState,
): Promise<void> {
    const sorted: JsonObject = {};

    for (const [id, item] of Object.entries(packages).sort(([a], [b]) => {
        return a.localeCompare(b);
    })) {
        sorted[id] = {
            name: item.name,
            repo: item.repo,
            commit: item.commit,
            ...(item.branch === undefined ? {} : { branch: item.branch }),
        };
    }

    await atomicWrite(
        join(home, "global_packages.json"),
        serializeJson({ stateVersion: 1, packages: sorted }),
    );
}
