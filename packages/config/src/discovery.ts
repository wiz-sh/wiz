import { access } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";

export const CONFIG_FILENAME = "config.wiz.json";

async function exists(path: string): Promise<boolean> {
    try {
        await access(path);

        return true;
    } catch {
        return false;
    }
}

/** Finds the nearest Wiz configuration without crossing the filesystem root. */
export async function discoverConfig(
    start = process.cwd(),
    explicitPath?: string,
): Promise<string | undefined> {
    if (explicitPath !== undefined) {
        const path = isAbsolute(explicitPath)
            ? explicitPath
            : resolve(start, explicitPath);

        return (await exists(path)) ? path : undefined;
    }

    let current = resolve(start);

    const root = parse(current).root;

    while (true) {
        const candidate = join(current, CONFIG_FILENAME);

        if (await exists(candidate)) {
            return candidate;
        }

        if (current === root) {
            return undefined;
        }

        current = dirname(current);
    }
}
