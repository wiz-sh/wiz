import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { WizError } from "../utils/errors.ts";

export interface ProjectTemplate {
    name: string;
    description: string;
    files: Readonly<Record<string, string>>;
}

const baseConfig = `${JSON.stringify(
    {
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
    },
    null,
    4,
)}\n`;

const builtInTemplates: readonly ProjectTemplate[] = [
    {
        name: "basic",
        description: "A typed Wiz script with strict checking.",
        files: {
            ".gitignore": "wiz_modules/\ndist/\n",
            "config.wiz.json": baseConfig,
            "src/main.wiz": `#!/usr/bin/env bash

greet(string name="world"): status {
    printf 'Hello, %s!\\n' "$name"
}

greet "${"{{projectName}}"}"
`,
        },
    },
    {
        name: "cli",
        description: "An executable typed command-line application.",
        files: {
            ".gitignore": "wiz_modules/\ndist/\n",
            "config.wiz.json": baseConfig,
            "src/main.wiz": `#!/usr/bin/env bash

main(string command="help"): status {
    case "$command" in
        help)
            printf 'Usage: ${"{{projectName}}"} <command>\\n'
            ;;
        *)
            printf 'Unknown command: %s\\n' "$command" >&2
            return 64
            ;;
    esac
}

main "$@"
`,
        },
    },
    {
        name: "library",
        description: "A scoped Wiz module with a declaration file.",
        files: {
            ".gitignore": "wiz_modules/\ndist/\n",
            "config.wiz.json": baseConfig,
            "src/index.wiz": `format_greeting(string name): string {
    printf 'Hello, %s!\\n' "$name"
}

export -f format_greeting
`,
            "src/index.d.wiz": `## Formats a friendly greeting.
declare command format_greeting(name: string): string
`,
        },
    },
];

function safeTemplatePath(path: string): boolean {
    return (
        path.length > 0 &&
        !path.startsWith("/") &&
        !path.split(/[\\/]/).includes("..")
    );
}

function render(source: string, projectName: string): string {
    return source.replaceAll("{{projectName}}", projectName);
}

function projectManifest(name: string, main: string): string {
    return `${JSON.stringify(
        {
            $schema: "./node_modules/@wiz/pm/schemas/manifest.schema.json",
            name,
            version: "0.1.0",
            main,
            scripts: {
                build: "wiz c build",
                check: "wiz check",
                test: `wiz run ${main}`,
            },
            bin: {},
            dependencies: {},
        },
        null,
        4,
    )}\n`;
}

async function directoryFiles(
    root: string,
    directory = root,
): Promise<Record<string, string>> {
    const result: Record<string, string> = {};

    for (const name of await readdir(directory)) {
        if (name === "template.wiz.json") {
            continue;
        }

        const path = join(directory, name);

        const metadata = await lstat(path);

        if (metadata.isSymbolicLink()) {
            throw new WizError(
                `Template cannot contain symbolic links: ${path}`,
            );
        }

        if (metadata.isDirectory()) {
            Object.assign(result, await directoryFiles(root, path));

            continue;
        }

        if (!metadata.isFile()) {
            throw new WizError(
                `Template contains an unsupported file: ${path}`,
            );
        }

        const relative = path.slice(root.length + 1);

        if (!safeTemplatePath(relative)) {
            throw new WizError(`Template path is unsafe: ${relative}`);
        }

        result[relative] = await readFile(path, "utf8");
    }

    return result;
}

/** Returns metadata for templates shipped with Wiz. */
export function listProjectTemplates(): readonly Omit<
    ProjectTemplate,
    "files"
>[] {
    return builtInTemplates.map((template) => {
        return { name: template.name, description: template.description };
    });
}

/** Creates a project from a built-in template or a user-authored template directory. */
export async function createProject(
    templateSpecifier: string,
    destination: string,
): Promise<string> {
    const root = resolve(destination);

    const projectName = basename(root)
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^[._-]+|[._-]+$/g, "");

    if (projectName.length === 0) {
        throw new WizError(
            "The destination does not produce a valid package name",
        );
    }

    const builtIn = builtInTemplates.find((template) => {
        return template.name === templateSpecifier;
    });

    const files =
        builtIn?.files ?? (await directoryFiles(resolve(templateSpecifier)));

    await mkdir(root, { recursive: true });

    const main =
        files["src/main.wiz"] !== undefined ? "src/main.wiz" : "src/index.wiz";

    const completeFiles = {
        ...files,
        ...(files["manifest.json"] === undefined
            ? { "manifest.json": projectManifest(projectName, main) }
            : {}),
    };

    for (const [relative, source] of Object.entries(completeFiles)) {
        if (!safeTemplatePath(relative)) {
            throw new WizError(`Template path is unsafe: ${relative}`);
        }

        const path = join(root, relative);

        await mkdir(resolve(path, ".."), { recursive: true });

        try {
            await writeFile(path, render(source, projectName), {
                flag: "wx",
                mode: relative.endsWith(".wiz") ? 0o755 : 0o600,
            });
        } catch (err) {
            const reason = err instanceof Error ? `: ${err.message}` : "";

            throw new WizError(
                `Cannot create ${root}; destination files must not already exist${reason}`,
            );
        }
    }

    return projectName;
}
