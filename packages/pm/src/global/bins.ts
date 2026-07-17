import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
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
    type BinState,
    optionalBranch,
    requiredString,
} from "./registration.ts";

export type { BinRegistration, BinState } from "./registration.ts";

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export async function readBinState(home: string): Promise<BinState> {
    try {
        const parsed = parseJson(
            await readFile(join(home, "bin_state.json"), "utf8"),
            "bin_state.json",
        );

        const root = requireJsonObject(parsed, "global bin state");

        assertJsonKeys(root, ["stateVersion", "bins"], "global bin state");

        if (root.stateVersion !== 1) {
            throw new WizError("Unsupported global bin state version");
        }

        const bins = requireJsonObject(
            root.bins ?? {},
            "global bin state bins",
        );

        return Object.fromEntries(
            Object.entries(bins).map(([name, value]) => {
                const item = requireJsonObject(value, `global bin ${name}`);

                assertJsonKeys(
                    item,
                    ["package", "repo", "commit", "bin", "path", "branch"],
                    `global bin ${name}`,
                );

                return [
                    name,
                    {
                        package: requiredString(
                            item.package,
                            `global bin ${name}.package`,
                        ),
                        repo: requiredString(
                            item.repo,
                            `global bin ${name}.repo`,
                        ),
                        commit: requiredString(
                            item.commit,
                            `global bin ${name}.commit`,
                        ),
                        bin: requiredString(item.bin, `global bin ${name}.bin`),
                        path: requiredString(
                            item.path,
                            `global bin ${name}.path`,
                        ),
                        ...optionalBranch(
                            item.branch,
                            `global bin ${name}.branch`,
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

export async function writeBinState(
    home: string,
    state: BinState,
): Promise<void> {
    const bins: JsonObject = {};

    for (const [name, item] of Object.entries(state).sort(([a], [b]) => {
        return a.localeCompare(b);
    })) {
        bins[name] = {
            package: item.package,
            repo: item.repo,
            commit: item.commit,
            bin: item.bin,
            path: item.path,
            ...(item.branch === undefined ? {} : { branch: item.branch }),
        };
    }

    await atomicWrite(
        join(home, "bin_state.json"),
        serializeJson({ stateVersion: 1, bins }),
    );
}

export async function writeWrapper(
    home: string,
    name: string,
    target: string,
    environment: Readonly<Record<string, string>> = {},
): Promise<void> {
    const binDirectory = join(home, "bin");

    await mkdir(binDirectory, { recursive: true });

    const wrapper = join(binDirectory, name);

    let exports = "";

    for (const [key, value] of Object.entries(environment)) {
        exports += `export ${key}=${shellQuote(value)}\n`;
    }

    await atomicWrite(
        wrapper,
        `#!/usr/bin/env bash\n${exports}exec ${shellQuote(target)} "$@"\n`,
    );

    await chmod(wrapper, 0o755);
}

export async function removeWrapper(home: string, name: string): Promise<void> {
    await rm(join(home, "bin", name), { force: true });
}
