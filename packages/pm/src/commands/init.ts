import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseManifest, serializeManifest } from "../project/manifest.ts";
import type { Manifest } from "../types.ts";
import { isCodedError, WizError } from "../utils/errors.ts";

function packageNameFromDirectory(directory: string): string {
    const normalized = basename(resolve(directory))
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^[._-]+|[._-]+$/g, "");

    if (normalized.length === 0) {
        throw new WizError(
            "Unable to derive a package name; provide one with wiz init <name>",
        );
    }

    return normalized;
}

function initialManifest(
    name: string,
    directory: string,
    monorepo: boolean,
): Manifest {
    const manifest: Manifest = {
        package: {
            name,
            index: "src/index.sh",
            ...(monorepo ? { private: true } : {}),
        },
        scripts: {},
        bins: {},
        dependencies: {},
        ...(monorepo ? { workspaces: ["packages/*"] } : {}),
    };

    return parseManifest(serializeManifest(manifest), directory);
}

function ignoresPath(source: string, expected: string): boolean {
    return source.split(/\r?\n/).some((line) => {
        const entry = line.trim().replace(/^\//, "").replace(/\/$/, "");

        return entry === expected;
    });
}

async function ensureGitignore(directory: string): Promise<void> {
    const path = join(directory, ".gitignore");

    let source = "";

    try {
        source = await readFile(path, "utf8");
    } catch (err) {
        if (
            !(err instanceof Error) ||
            !isCodedError(err) ||
            err.code !== "ENOENT"
        ) {
            throw err;
        }
    }

    const missing = ["wiz_modules", "dist"].filter((entry) => {
        return !ignoresPath(source, entry);
    });

    if (missing.length === 0) {
        return;
    }

    const separator = source.length > 0 && !source.endsWith("\n") ? "\n" : "";

    await appendFile(
        path,
        `${separator}${missing
            .map((entry) => {
                return `${entry}/`;
            })
            .join("\n")}\n`,
    );
}

async function writeIfMissing(
    path: string,
    contents: string,
    mode: number,
): Promise<void> {
    try {
        await writeFile(path, contents, {
            flag: "wx",
            mode,
        });
    } catch (err) {
        // Existing source and configuration belong to the user and must survive init.
        if (
            err instanceof Error &&
            isCodedError(err) &&
            err.code === "EEXIST"
        ) {
            return;
        }

        throw err;
    }
}

async function createProjectScaffold(directory: string): Promise<void> {
    const sourceDirectory = join(directory, "src");

    await mkdir(sourceDirectory, {
        recursive: true,
    });

    await writeIfMissing(
        join(sourceDirectory, "index.sh"),
        "#!/usr/bin/env bash\n",
        0o755,
    );

    const config = {
        compiler: {
            target: "bash",
            rootDir: "./src",
            outDir: "./dist",
            sourceMap: true,
            noEmitOnError: true,
            runtimeChecks: "boundaries",
        },
        typeChecking: {
            strict: true,
            allowAny: false,
            implicitAny: false,
            unknownCommands: "warning",
            checkSourcedFiles: true,
            checkDeclarationFiles: true,
        },
    };

    await writeIfMissing(
        join(directory, "config.wiz.json"),
        `${JSON.stringify(config, null, 4)}\n`,
        0o600,
    );
}

/** Creates a new manifest without replacing an existing project definition. */
export async function init(
    name?: string,
    directory = process.cwd(),
    monorepo = false,
): Promise<string> {
    const packageName = name ?? packageNameFromDirectory(directory);

    const manifest = initialManifest(packageName, directory, monorepo);

    const path = join(directory, "manifest.json");

    try {
        await writeFile(path, serializeManifest(manifest), {
            flag: "wx",
            mode: 0o600,
        });
    } catch (err) {
        if (
            err instanceof Error &&
            isCodedError(err) &&
            err.code === "EEXIST"
        ) {
            throw new WizError("manifest.json already exists");
        }

        throw err;
    }

    await ensureGitignore(directory);

    await createProjectScaffold(directory);

    if (monorepo) {
        await mkdir(join(directory, "packages"), { recursive: true });
    }

    return manifest.package.name;
}
