#!/usr/bin/env bun

import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const examplesRoot = import.meta.dir;
const repositoryRoot = resolve(examplesRoot, "..");
const wizCli = join(repositoryRoot, "apps/cli/src/cli.ts");

interface ExampleDefinition {
    id: string;
    directory: string;
    description: string;
    category: "package-management" | "packages" | "registry" | "wiz";
}

interface CommandStep {
    label: string;
    command: readonly string[];
    directory?: string;
}

interface RunnerOptions {
    keep: boolean;
    dryRun: boolean;
    arguments: readonly string[];
}

function displayCommand(command: readonly string[]): string {
    return command
        .map((part) => {
            return /^[A-Za-z0-9_./:@=-]+$/.test(part)
                ? part
                : JSON.stringify(part);
        })
        .join(" ");
}

function descriptionFromReadme(source: string): string {
    const paragraphs = source
        .split(/\n\s*\n/)
        .map((paragraph) => {
            return paragraph.replaceAll("\n", " ").trim();
        })
        .filter((paragraph) => {
            return paragraph !== "" && !paragraph.startsWith("#");
        });

    return paragraphs[0] ?? "Runnable Wiz example";
}

async function discoverExamples(): Promise<readonly ExampleDefinition[]> {
    const result: ExampleDefinition[] = [];

    for (const category of [
        "package-management",
        "packages",
        "registry",
        "wiz",
    ] as const) {
        const categoryRoot = join(examplesRoot, category);

        for (const entry of await readdir(categoryRoot, {
            withFileTypes: true,
        })) {
            if (!entry.isDirectory()) {
                continue;
            }

            const directory = join(categoryRoot, entry.name);
            const readme = await readFile(join(directory, "README.md"), "utf8");

            result.push({
                id: `${category}/${entry.name}`,
                directory,
                description: descriptionFromReadme(readme),
                category,
            });
        }
    }

    return result.toSorted((left, right) => {
        return left.id.localeCompare(right.id);
    });
}

function wizStep(
    label: string,
    arguments_: readonly string[],
    directory?: string,
): CommandStep {
    return {
        label,
        command: [process.execPath, wizCli, ...arguments_],
        ...(directory === undefined ? {} : { directory }),
    };
}

function wizEntry(example: ExampleDefinition): string {
    return (
        ["main.wiz", "src/main.wiz"].find((candidate) => {
            return Bun.file(join(example.directory, candidate)).size > 0;
        }) ?? "main.wiz"
    );
}

function wizSteps(
    example: ExampleDefinition,
    arguments_: readonly string[],
): readonly CommandStep[] {
    const name = basename(example.directory);

    if (name === "bundling") {
        return [
            wizStep("bundle and minify", [
                "c",
                "build",
                "--bundle",
                "--minify",
            ]),
            {
                label: "execute bundled Bash",
                command: ["bash", "dist/main.sh", ...arguments_],
            },
        ];
    }

    if (name === "compiler-targets") {
        const targets = [
            { target: "bash", executable: "bash", output: "dist/main.sh" },
            { target: "zsh", executable: "zsh", output: "dist/main.zsh" },
            { target: "sh", executable: "sh", output: "dist/main.sh" },
            {
                target: "fish",
                executable: "fish",
                output: "dist/main.fish",
            },
            {
                target: "powershell",
                executable: "pwsh",
                output: "dist/main.ps1",
            },
        ];

        return targets.flatMap((target) => {
            if (Bun.which(target.executable) === null) {
                return [];
            }

            return [
                wizStep(`compile for ${target.target}`, [
                    "c",
                    "build",
                    "src/main.wiz",
                    "--target",
                    target.target,
                ]),
                {
                    label: `execute with ${target.executable}`,
                    command: [target.executable, target.output, ...arguments_],
                },
            ];
        });
    }

    if (name === "formatter") {
        return [wizStep("check formatting", ["format", "--check", "."])];
    }

    if (name === "linter") {
        return [wizStep("run the linter", ["lint", "."])];
    }

    if (name === "type-packages") {
        return [
            wizStep("type-check imported declarations", ["c", "check"]),
            wizStep("build without runtime imports", ["c", "build"]),
        ];
    }

    if (name === "complete-project") {
        return [
            wizStep("type-check", ["c", "check"]),
            wizStep("format-check", ["format", "--check", "."]),
            wizStep("lint", ["lint", "."]),
            wizStep("execute", ["src/main.wiz", "--", ...arguments_]),
        ];
    }

    if (name === "config-inheritance") {
        return [
            wizStep("show merged configuration", ["c", "config"]),
            wizStep("execute", ["src/main.wiz", "--", ...arguments_]),
        ];
    }

    return [wizStep("execute", [wizEntry(example), "--", ...arguments_])];
}

function registrySteps(): readonly CommandStep[] {
    return [
        {
            label: "validate the self-hosting configuration",
            command: ["docker", "compose", "-f", "compose.yaml", "config"],
        },
    ];
}

function packageSteps(
    example: ExampleDefinition,
    arguments_: readonly string[],
): readonly CommandStep[] {
    const name = basename(example.directory);

    if (name === "command-runner") {
        return [
            wizStep("run manifest script", [
                "script",
                "greet",
                "--",
                ...(arguments_.length === 0 ? ["Wiz"] : arguments_),
            ]),
        ];
    }

    if (name === "monorepo") {
        return [
            wizStep("install workspace links", ["install"]),
            {
                label: "execute workspace application",
                command: ["bash", "apps/demo/index.sh", ...arguments_],
            },
        ];
    }

    if (name === "git-dependency") {
        return [
            {
                label: "initialize example Git package",
                command: ["git", "init", "-b", "main"],
                directory: "logger",
            },
            {
                label: "configure Git author",
                command: ["git", "config", "user.name", "Wiz Examples"],
                directory: "logger",
            },
            {
                label: "configure Git email",
                command: ["git", "config", "user.email", "wiz@example.invalid"],
                directory: "logger",
            },
            {
                label: "stage package",
                command: ["git", "add", "."],
                directory: "logger",
            },
            {
                label: "commit package",
                command: ["git", "commit", "-m", "example package"],
                directory: "logger",
            },
            wizStep("install Git dependency", ["install", "../logger"], "app"),
            wizStep(
                "execute installed bin",
                [
                    "x",
                    "logger",
                    "--",
                    ...(arguments_.length === 0
                        ? ["installed from Git"]
                        : arguments_),
                ],
                "app",
            ),
            wizStep(
                "verify frozen lockfile",
                ["install", "--frozen-lockfile"],
                "app",
            ),
        ];
    }

    return [wizStep("inspect package", ["info"])];
}

function stepsFor(
    example: ExampleDefinition,
    arguments_: readonly string[],
): readonly CommandStep[] {
    if (example.category === "wiz") {
        return wizSteps(example, arguments_);
    }

    if (example.category === "registry") {
        return registrySteps();
    }

    return packageSteps(example, arguments_);
}

class ExampleRunner {
    async run(
        example: ExampleDefinition,
        options: RunnerOptions,
    ): Promise<void> {
        const temporaryRoot = await mkdtemp(join(tmpdir(), "wiz-example-"));
        const workspace = join(temporaryRoot, "project");
        const home = join(temporaryRoot, "home");

        await cp(example.directory, workspace, { recursive: true });

        console.info(`\n▶ ${example.id}`);

        try {
            for (const step of stepsFor(example, options.arguments)) {
                const directory = join(workspace, step.directory ?? ".");

                console.info(`  ${step.label}`);
                console.info(`  $ ${displayCommand(step.command)}`);

                if (options.dryRun) {
                    continue;
                }

                const child = Bun.spawn([...step.command], {
                    cwd: directory,
                    env: {
                        ...process.env,
                        HOME: home,
                        WIZ_HOME: join(home, ".wiz"),
                        WIZ_CONFIG: join(home, ".config", "wiz.json"),
                    },
                    stdin: "inherit",
                    stdout: "inherit",
                    stderr: "inherit",
                });

                const exitCode = await child.exited;

                if (exitCode !== 0) {
                    throw new Error(
                        `${example.id} failed during “${step.label}” with exit code ${exitCode}`,
                    );
                }
            }

            console.info(`✓ ${example.id}`);
        } finally {
            if (options.keep) {
                console.info(`  Working copy: ${workspace}`);
            } else {
                await rm(temporaryRoot, { recursive: true, force: true });
            }
        }
    }
}

function printHelp(): void {
    console.log(`Wiz example runner

Usage:
  bun run example list
  bun run example <name> [--keep] [--dry-run] [-- arguments...]
  bun run example all [--keep] [--dry-run]

Examples:
  bun run example hello-world
  bun run example wiz/compiler-targets
  bun run example command-runner -- Hazel
  bun run example all
`);
}

function resolveExample(
    examples: readonly ExampleDefinition[],
    selector: string,
): ExampleDefinition {
    const matches = examples.filter((example) => {
        return (
            example.id === selector || basename(example.directory) === selector
        );
    });

    if (matches.length === 0) {
        throw new Error(
            `Unknown example: ${selector}. Run “bun run example list”.`,
        );
    }

    if (matches.length > 1) {
        throw new Error(
            `Ambiguous example: ${selector}. Use one of: ${matches.map((entry) => entry.id).join(", ")}`,
        );
    }

    const match = matches[0];

    if (match === undefined) {
        throw new Error(`Unknown example: ${selector}`);
    }

    return match;
}

async function main(arguments_: readonly string[]): Promise<void> {
    const delimiter = arguments_.indexOf("--");
    const runnerArguments =
        delimiter < 0 ? arguments_ : arguments_.slice(0, delimiter);
    const exampleArguments =
        delimiter < 0 ? [] : arguments_.slice(delimiter + 1);
    const keep = runnerArguments.includes("--keep");
    const dryRun = runnerArguments.includes("--dry-run");
    const positional = runnerArguments.filter((argument) => {
        return argument !== "--keep" && argument !== "--dry-run";
    });
    const command = positional[0];
    const examples = await discoverExamples();

    if (command === undefined || command === "help" || command === "--help") {
        printHelp();

        return;
    }

    if (command === "list") {
        for (const example of examples) {
            console.log(`${example.id.padEnd(42)} ${example.description}`);
        }

        return;
    }

    const selected = command === "run" ? positional[1] : command;

    if (selected === undefined) {
        throw new Error("The run command requires an example name");
    }

    const runner = new ExampleRunner();
    const targets =
        selected === "all" ? examples : [resolveExample(examples, selected)];

    for (const example of targets) {
        await runner.run(example, {
            keep,
            dryRun,
            arguments: exampleArguments,
        });
    }
}

if (import.meta.main) {
    try {
        await main(Bun.argv.slice(2));
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));

        process.exitCode = 1;
    }
}

export { discoverExamples, ExampleRunner, main };
