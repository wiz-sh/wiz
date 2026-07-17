import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { defaultConfig } from "./defaults.ts";
import { discoverConfig } from "./discovery.ts";
import { mergeConfig } from "./merge.ts";
import { normalizeConfig } from "./normalize.ts";
import type { ConfigDiagnostic, LoadConfigResult, WizConfig } from "./types.ts";
import { validateConfigValue } from "./validation.ts";

async function readValue(
    path: string,
    seen: Set<string>,
): Promise<{ value: Partial<WizConfig>; diagnostics: ConfigDiagnostic[] }> {
    // Inheritance is recursive, so the visited set protects both direct and indirect cycles.
    if (seen.has(path)) {
        return {
            value: {},
            diagnostics: [
                {
                    code: "WIZCFG005",
                    severity: "error",
                    message: `Circular configuration inheritance: ${path}`,
                },
            ],
        };
    }

    seen.add(path);

    let parsed: unknown;

    try {
        parsed = JSON.parse(await readFile(path, "utf8"));
    } catch (err) {
        return {
            value: {},
            diagnostics: [
                {
                    code: "WIZCFG004",
                    severity: "error",
                    message: `Cannot read configuration ${path}: ${err instanceof Error ? err.message : String(err)}`,
                },
            ],
        };
    }

    const diagnostics = validateConfigValue(parsed);

    const raw =
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Partial<WizConfig> & { extends?: string })
            : {};

    const valid = diagnostics.every((diagnostic) => {
        return diagnostic.severity !== "error";
    });

    const currentValue: Partial<WizConfig> = valid
        ? normalizePartialPaths(raw, path)
        : {};

    if (typeof raw.extends !== "string") {
        return { value: currentValue, diagnostics };
    }

    const parentPath = resolve(dirname(path), raw.extends);

    const parent = await readValue(parentPath, seen);

    const { extends: _extends, ...current } =
        currentValue as Partial<WizConfig> & {
            extends?: string;
        };

    return {
        value: mergeConfig(parent.value, current),
        diagnostics: [...parent.diagnostics, ...diagnostics],
    };
}

function normalizePartialPaths(
    value: Partial<WizConfig>,
    path: string,
): Partial<WizConfig> {
    if (value.compiler === undefined) {
        return value;
    }

    const root = dirname(path);

    return {
        ...value,
        compiler: {
            ...value.compiler,
            ...(typeof value.compiler.rootDir === "string"
                ? { rootDir: resolve(root, value.compiler.rootDir) }
                : {}),
            ...(typeof value.compiler.outDir === "string"
                ? { outDir: resolve(root, value.compiler.outDir) }
                : {}),
        },
    };
}

/** Loads, validates, inherits, merges, and path-normalizes project configuration. */
export async function loadConfig(
    start = process.cwd(),
    explicitPath?: string,
): Promise<LoadConfigResult> {
    const path = await discoverConfig(start, explicitPath);

    if (path === undefined) {
        const root = resolve(start);

        return {
            config: normalizeConfig(defaultConfig(root)),
            diagnostics:
                explicitPath === undefined
                    ? []
                    : [
                          {
                              code: "WIZCFG006",
                              severity: "error",
                              message: `Configuration not found: ${explicitPath}`,
                          },
                      ],
        };
    }

    const loaded = await readValue(path, new Set());

    const merged = mergeConfig(defaultConfig(dirname(path)), loaded.value);

    return {
        config: normalizeConfig(merged, path),
        diagnostics: loaded.diagnostics,
    };
}
