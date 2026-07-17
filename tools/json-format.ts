import { readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const ignoredDirectories = new Set([
    ".astro",
    ".git",
    "coverage",
    "dist",
    "node_modules",
    "wiz_modules",
]);

interface FormatResult {
    checked: number;
    changed: readonly string[];
}

/** Produces the repository's canonical, human-readable JSON representation. */
export function formatJson(source: string): string {
    const value: unknown = JSON.parse(source);

    return `${JSON.stringify(value, null, 4)}\n`;
}

async function findJsonFiles(directory: string): Promise<string[]> {
    const files: string[] = [];

    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
            continue;
        }

        const path = join(directory, entry.name);

        if (entry.isDirectory()) {
            files.push(...(await findJsonFiles(path)));

            continue;
        }

        if (entry.isFile() && extname(entry.name) === ".json") {
            files.push(path);
        }
    }

    return files;
}

/** Checks or rewrites every repository-owned JSON file in a stable order. */
export async function formatRepositoryJson(
    root: string,
    checkOnly: boolean,
): Promise<FormatResult> {
    const files = (await findJsonFiles(resolve(root))).toSorted();
    const changed: string[] = [];

    for (const path of files) {
        const source = await Bun.file(path).text();
        let formatted: string;

        try {
            formatted = formatJson(source);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);

            throw new Error(
                `Cannot format ${relative(root, path)}: ${message}`,
            );
        }

        if (source === formatted) {
            continue;
        }

        const displayPath = relative(root, path);

        changed.push(displayPath);

        if (!checkOnly) {
            await Bun.write(path, formatted);
        }
    }

    return {
        checked: files.length,
        changed,
    };
}

if (import.meta.main) {
    const checkOnly = Bun.argv.includes("--check");
    const result = await formatRepositoryJson(process.cwd(), checkOnly);

    if (checkOnly && result.changed.length > 0) {
        console.error("JSON files are not canonically formatted:");

        for (const path of result.changed) {
            console.error(`  ${path}`);
        }

        console.error("Run `bun run format:json` to fix them.");
        process.exitCode = 1;
    } else if (!checkOnly) {
        console.log(
            `Formatted ${result.changed.length} of ${result.checked} JSON files.`,
        );
    }
}
