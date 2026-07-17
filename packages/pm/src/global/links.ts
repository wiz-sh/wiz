import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { replaceSymlink } from "../dependencies/store.ts";
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
    type GlobalLinkState,
    type ProjectLinkState,
    requiredString,
} from "./registration.ts";

const packageNamePattern = /^[a-z0-9][a-z0-9._-]*$/;
const binNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export type {
    GlobalLinkRegistration,
    GlobalLinkState,
    ProjectLinkRegistration,
    ProjectLinkState,
} from "./registration.ts";

function validateName(name: string, pattern: RegExp, label: string): void {
    if (!pattern.test(name)) {
        throw new WizError(`Invalid ${label}: ${name}`);
    }
}

function linkedPath(
    value: JsonObject[string] | undefined,
    label: string,
): string {
    const path = requiredString(value, label);

    if (!isAbsolute(path)) {
        throw new WizError(`${label} must be an absolute path`);
    }

    return path;
}

function readBins(value: JsonObject, label: string): Record<string, string> {
    const bins: Record<string, string> = {};

    for (const [name, path] of Object.entries(value)) {
        validateName(name, binNamePattern, "linked bin name");

        bins[name] = requiredString(path, `${label}.${name}`);
    }

    return bins;
}

export async function readGlobalLinks(home: string): Promise<GlobalLinkState> {
    try {
        const parsed = parseJson(
            await readFile(join(home, "link_state.json"), "utf8"),
            "link_state.json",
        );

        const root = requireJsonObject(parsed, "global link state");

        assertJsonKeys(root, ["stateVersion", "packages"], "global link state");

        if (root.stateVersion !== 1) {
            throw new WizError("Unsupported global link state version");
        }

        const packages = requireJsonObject(root.packages ?? {}, "global links");

        const result: GlobalLinkState = {};

        for (const [name, value] of Object.entries(packages)) {
            validateName(name, packageNamePattern, "linked package name");

            const item = requireJsonObject(value, `global link ${name}`);

            assertJsonKeys(item, ["path", "bins"], `global link ${name}`);

            result[name] = {
                path: linkedPath(item.path, `global link ${name}.path`),
                bins: readBins(
                    requireJsonObject(
                        item.bins ?? {},
                        `global link ${name}.bins`,
                    ),
                    `global link ${name}.bins`,
                ),
            };
        }

        return result;
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

export async function writeGlobalLinks(
    home: string,
    links: GlobalLinkState,
): Promise<void> {
    const packages: JsonObject = {};

    for (const [name, item] of Object.entries(links).sort(([a], [b]) => {
        return a.localeCompare(b);
    })) {
        packages[name] = {
            path: item.path,
            bins: Object.fromEntries(
                Object.entries(item.bins).sort(([a], [b]) => {
                    return a.localeCompare(b);
                }),
            ),
        };
    }

    await atomicWrite(
        join(home, "link_state.json"),
        serializeJson({ stateVersion: 1, packages }),
    );
}

export async function readProjectLinks(
    root: string,
): Promise<ProjectLinkState> {
    try {
        const parsed = parseJson(
            await readFile(join(root, "wiz.links.json"), "utf8"),
            "wiz.links.json",
        );

        const state = requireJsonObject(parsed, "project link state");

        assertJsonKeys(state, ["stateVersion", "links"], "project link state");

        if (state.stateVersion !== 1) {
            throw new WizError("Unsupported project link state version");
        }

        const records = requireJsonObject(state.links ?? {}, "project links");

        const result: ProjectLinkState = {};

        for (const [name, value] of Object.entries(records)) {
            validateName(name, packageNamePattern, "project link name");

            const item = requireJsonObject(value, `project link ${name}`);

            assertJsonKeys(item, ["path"], `project link ${name}`);

            result[name] = {
                path: linkedPath(item.path, `project link ${name}.path`),
            };
        }

        return result;
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

export async function writeProjectLinks(
    root: string,
    links: ProjectLinkState,
): Promise<void> {
    const records: JsonObject = {};

    for (const [name, item] of Object.entries(links).sort(([a], [b]) => {
        return a.localeCompare(b);
    })) {
        records[name] = {
            path: item.path,
        };
    }

    await atomicWrite(
        join(root, "wiz.links.json"),
        serializeJson({ stateVersion: 1, links: records }),
    );
}

export async function applyProjectLinks(
    projectRoot: string,
    modulesRoot: string,
): Promise<void> {
    const links = await readProjectLinks(projectRoot);

    for (const [name, registration] of Object.entries(links)) {
        const target = await realpath(registration.path);

        const destination = join(modulesRoot, name);

        await replaceSymlink(
            destination,
            relative(dirname(destination), target),
        );
    }
}
