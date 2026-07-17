#!/usr/bin/env bun
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { discoverConfig } from "@wiz-sh/config";
import {
    add,
    addRegistry,
    addWorkspace,
    approve,
    binList,
    binRemove,
    binSet,
    clean,
    cleanTarget,
    createProject,
    discoverWorkspaces,
    doctor,
    errorMessage,
    findProjectRootIfPresent,
    findWorkspaceRoot,
    info,
    init,
    install,
    installGlobal,
    link,
    list,
    listProjectTemplates,
    prune,
    remove,
    removeGlobal,
    unlink,
    update,
    verifyCache,
    WizError,
    why,
} from "@wiz-sh/pm";
import { dlx, indexPath, needs, run, script, x } from "@wiz-sh/runtime";
import chalk from "chalk";
import {
    parseDlxArguments,
    parseInstallArguments,
    requiredArgument,
} from "./arguments.ts";
import { loginMain, logoutMain, registryMain, whoamiMain } from "./registry.ts";
import {
    deprecateMain,
    organizationMain,
    publishMain,
    searchMain,
    viewMain,
} from "./registry-packages.ts";
import { VERSION } from "./version.ts";
import { COMPILER_HELP, compilerMain } from "./wiz.ts";

const HELP = `${chalk.bold.cyan("Wiz")} - Typed shell tooling and package management

Usage: wiz <command> [options]

Commands:
  create <template> [directory] | create --list
  init [name] [--monorepo]
  install, i [repo] [--branch name] [--commit sha] [--workspace name] [-g|--global] [--frozen-lockfile]
  update [package]
  run <path> [args...]
  script <name> [--] [args...]
  x <bin|package/bin> [--] [args...]
  dlx <repo> [--branch name] [--commit sha] [--bin name] [--] [args...]
  index [package]
  resolve [package]
  list [--global]
  info
  why <package>
  doctor
  cache verify
  remove, rm [-g|--global] <package>
  link [package]
  unlink [package] [-g|--global]
  clean [--yes]
  prune [--global] [--dry-run]
  approve [package...]
  bin list|set|remove
  root
  needs <binary>
  workspace list|root|add|run
  check [file] [--target bash|zsh|sh|fish|powershell|cmd]
  watch [file] [-- args...]
  format, fmt [--write|--check|--minify] <path...>
  lint [--fix|--fix-unsafe] <path...>
  registry list|get|add|set-default|remove|set-token|logout|whoami|ping
  login [registry] [--token token]
  logout [registry]
  whoami [registry]
  publish [--access=private]
  deprecate <package>@<version> <message>
  search <query>
  view <package>
  org create|list|view
  c <command>

Options: -h, --help  -v, --version`;

function commandHelp(command: string): string {
    const usage: Record<string, string> = {
        init: "wiz init [name] [--monorepo]",
        create: "wiz create <template> [directory] | wiz create --list",
        install:
            "wiz install [repo] [--branch name] [--commit sha] [-g|--global] [--frozen-lockfile]",
        i: "wiz i [repo] [--branch name] [--commit sha] [-g|--global] [--frozen-lockfile]",
        update: "wiz update [package]",
        run: "wiz run <path> [args...]",
        script: "wiz script <name> [--] [args...]",
        x: "wiz x <bin|package/bin> [--] [args...]",
        dlx: "wiz dlx <repo> [--branch name] [--commit sha] [--bin name] [--] [args...]",
        index: "wiz index [package]",
        resolve: "wiz resolve [package]",
        list: "wiz list [--global]",
        info: "wiz info",
        why: "wiz why <package>",
        doctor: "wiz doctor",
        cache: "wiz cache verify",
        remove: "wiz remove [-g|--global] <package>",
        rm: "wiz rm [-g|--global] <package>",
        link: "wiz link [package]",
        unlink: "wiz unlink [package] [-g|--global]",
        clean: "wiz clean [--yes]",
        prune: "wiz prune [--global] [--dry-run]",
        approve: "wiz approve [package...]",
        bin: "wiz bin list | set <name> <package/bin> | remove <name>",
        root: "wiz root",
        needs: "wiz needs <binary>",
        workspace:
            "wiz workspace list [--json] | root | add <package> | run <script> [--if-present] [--] [args...]",
        check: "wiz check [file] [--target bash|zsh|sh|fish|powershell|cmd]",
        watch: "wiz watch [file] [--] [args...]",
        format: "wiz format [--write|--check|--minify] <path...>",
        fmt: "wiz fmt [--write|--check|--minify] <path...>",
        lint: "wiz lint [--fix|--fix-unsafe] <path...>",
        registry:
            "wiz registry list | get <name> | add <name> <url> | set-default <name> | remove <name> | set-token <name> --token <token> | logout [name] | whoami [name] | ping [name]",
        login: "wiz login [registry] [--token token]",
        logout: "wiz logout [registry]",
        whoami: "wiz whoami [registry]",
        publish: "wiz publish [--access=private]",
        deprecate: "wiz deprecate <package>@<version> <message>",
        search: "wiz search <query>",
        view: "wiz view <package>",
        org: "wiz org create|list|view",
        c: "wiz c <command> [options]",
    };

    return `${chalk.bold("Usage:")} ${usage[command] ?? `wiz ${command}`}\n`;
}

function packageArgument(args: readonly string[]): string {
    for (const value of args.slice(1)) {
        if (value !== "--global" && value !== "-g") {
            return requiredArgument(value, "package name");
        }
    }

    throw new WizError("Missing package name");
}

async function confirmClean(target: string): Promise<boolean> {
    const terminal = createInterface({
        input: process.stdin,
        output: process.stderr,
    });

    try {
        const answer = await terminal.question(
            `Remove all Wiz data at ${target}? [y/N] `,
        );

        const normalized = answer.trim().toLowerCase();

        return normalized === "y" || normalized === "yes";
    } finally {
        terminal.close();
    }
}

/** Dispatches CLI arguments without terminating the host process, which keeps the API testable. */
export async function main(args = Bun.argv.slice(2)): Promise<number> {
    const command = args[0];

    if (command?.endsWith(".wiz")) {
        return compilerMain(["run", ...args]);
    }

    if (command === undefined || command === "--help" || command === "-h") {
        console.log(HELP);

        return 0;
    }

    if (command === "--version" || command === "-v") {
        console.log(VERSION);

        return 0;
    }

    if (command === "c" && (args[1] === "--help" || args[1] === "-h")) {
        console.log(COMPILER_HELP);

        return 0;
    }

    if (args[1] === "--help" || args[1] === "-h") {
        console.log(commandHelp(command));

        return 0;
    }

    switch (command) {
        case "create": {
            if (args[1] === "--list") {
                for (const template of listProjectTemplates()) {
                    console.log(`${template.name}\t${template.description}`);
                }

                return 0;
            }

            const template = requiredArgument(args[1], "template name or path");

            const destination = args[2] ?? "wiz-project";

            const projectName = await createProject(template, destination);

            console.log(chalk.green(`Created ${projectName} from ${template}`));

            return 0;
        }

        case "init": {
            const unsupported = args.slice(1).find((value) => {
                return value.startsWith("-") && value !== "--monorepo";
            });

            if (unsupported !== undefined) {
                throw new WizError(`Unsupported init option: ${unsupported}`);
            }

            const names = args.slice(1).filter((value) => {
                return !value.startsWith("-");
            });

            if (names.length > 1) {
                throw new WizError(`Unexpected init argument: ${names[1]}`);
            }

            const packageName = await init(
                names[0],
                process.cwd(),
                args.includes("--monorepo"),
            );

            console.log(
                chalk.green(`Created manifest.json for ${packageName}`),
            );

            return 0;
        }

        case "install":
        case "i": {
            const parsed = parseInstallArguments(args);

            if (parsed.workspace !== undefined) {
                const packageName = await addWorkspace(parsed.workspace);

                console.log(
                    chalk.green(`Added workspace package ${packageName}`),
                );
            } else if (parsed.registry !== undefined) {
                const packageName = await addRegistry(parsed.registry);

                console.log(chalk.green(`Added ${packageName}`));
            } else if (parsed.add !== undefined) {
                const packageName = await add(parsed.add);

                console.log(chalk.green(`Added ${packageName}`));
            } else if (parsed.global) {
                await installGlobal();
            } else {
                await install(parsed.frozen);
            }

            return 0;
        }

        case "update":
            await update(args[1]);
            return 0;

        case "run":
            if (args[1]?.endsWith(".wiz")) {
                return compilerMain(["run", ...args.slice(1)]);
            }

            return run(
                requiredArgument(args[1], "executable path"),
                args.slice(2),
            );

        case "script": {
            const separator = args.indexOf("--");

            return script(
                requiredArgument(args[1], "script name"),
                separator < 0 ? [] : args.slice(separator + 1),
            );
        }

        case "x": {
            const separator = args.indexOf("--");

            return x(
                requiredArgument(args[1], "bin name"),
                separator < 0 ? args.slice(2) : args.slice(separator + 1),
            );
        }

        case "dlx": {
            const parsed = parseDlxArguments(args);

            return dlx(parsed.options, parsed.executableArgs);
        }

        case "index":
            console.log(await indexPath(args[1], false));
            return 0;

        case "resolve":
            console.log(await indexPath(args[1], true));
            return 0;

        case "list":
            for (const line of await list(args.includes("--global"))) {
                console.log(line);
            }

            return 0;

        case "info":
            for (const line of await info()) {
                console.log(line);
            }

            return 0;

        case "why":
            for (const line of await why(
                requiredArgument(args[1], "package name"),
            )) {
                console.log(line);
            }

            return 0;

        case "doctor":
            for (const line of await doctor()) {
                console.log(line);
            }

            return 0;

        case "cache":
            if (args[1] !== "verify") {
                throw new WizError(commandHelp("cache").trim());
            }

            for (const line of await verifyCache()) {
                console.log(line);
            }

            return 0;

        case "remove":
        case "rm": {
            const packageName = packageArgument(args);

            if (args.includes("--global") || args.includes("-g")) {
                await removeGlobal(packageName);
            } else {
                await remove(packageName);
            }

            return 0;
        }

        case "clean": {
            const target = cleanTarget();

            const confirmed =
                args.includes("--yes") || (await confirmClean(target));

            if (!confirmed) {
                console.log(chalk.yellow("Clean cancelled"));

                return 0;
            }

            await clean();

            console.log(chalk.green(`Removed all Wiz data at ${target}`));

            return 0;
        }

        case "link":
            for (const line of await link(args[1])) {
                console.log(chalk.green(line));
            }

            return 0;

        case "unlink": {
            const global = args.includes("--global") || args.includes("-g");

            const packageName = args.slice(1).find((value) => {
                return value !== "--global" && value !== "-g";
            });

            for (const line of await unlink(packageName, global)) {
                console.log(chalk.green(line));
            }

            return 0;
        }

        case "prune":
            for (const line of await prune(
                args.includes("--global"),
                args.includes("--dry-run"),
            )) {
                console.log(line);
            }

            return 0;

        case "approve":
            for (const line of await approve(args.slice(1))) {
                console.log(line);
            }

            return 0;

        case "bin":
            if (args[1] === "list") {
                for (const line of await binList()) {
                    console.log(line);
                }
            } else if (args[1] === "set") {
                await binSet(
                    requiredArgument(args[2], "bin name"),
                    requiredArgument(args[3], "package/bin target"),
                );
            } else if (args[1] === "remove") {
                await binRemove(requiredArgument(args[2], "bin name"));
            } else {
                throw new WizError(commandHelp("bin").trim());
            }

            return 0;

        case "root": {
            const packageRoot = await findProjectRootIfPresent();

            if (packageRoot !== undefined) {
                console.log(packageRoot);

                return 0;
            }

            const configPath = await discoverConfig();

            if (configPath === undefined) {
                throw new WizError("No Wiz project found");
            }

            console.log(dirname(configPath));

            return 0;
        }

        case "needs":
            needs(requiredArgument(args[1], "binary name"));
            return 0;

        case "workspace": {
            if (args[1] === "root") {
                console.log(await findWorkspaceRoot());

                return 0;
            }

            if (args[1] === "list") {
                const project = await discoverWorkspaces();

                const packages = [...project.packages.values()].sort(
                    (left, right) => {
                        return left.name.localeCompare(right.name);
                    },
                );

                if (args.includes("--json")) {
                    console.log(
                        JSON.stringify(
                            packages.map((workspacePackage) => {
                                return {
                                    name: workspacePackage.name,
                                    path: workspacePackage.relativePath,
                                };
                            }),
                            null,
                            4,
                        ),
                    );

                    return 0;
                }

                for (const workspacePackage of packages) {
                    console.log(
                        `${workspacePackage.name}\t${workspacePackage.relativePath}`,
                    );
                }

                return 0;
            }

            if (args[1] === "run") {
                const scriptName = requiredArgument(
                    args[2],
                    "workspace script name",
                );

                const project = await discoverWorkspaces();

                const packages = [...project.packages.values()]
                    .filter((workspacePackage) => {
                        return (
                            workspacePackage.manifest.scripts[scriptName] !==
                                undefined || !args.includes("--if-present")
                        );
                    })
                    .sort((left, right) => {
                        return left.name.localeCompare(right.name);
                    });

                const missing = packages.find((workspacePackage) => {
                    return (
                        workspacePackage.manifest.scripts[scriptName] ===
                        undefined
                    );
                });

                if (missing !== undefined) {
                    throw new WizError(
                        `Workspace ${missing.name} has no script named ${scriptName}; pass --if-present to skip it`,
                    );
                }

                const separator = args.indexOf("--");

                const scriptArguments =
                    separator < 0 ? [] : args.slice(separator + 1);

                const previousDirectory = process.cwd();

                try {
                    for (const workspacePackage of packages) {
                        console.log(
                            chalk.cyan(
                                `\n> ${workspacePackage.name} ${scriptName}`,
                            ),
                        );

                        process.chdir(workspacePackage.root);

                        const exitCode = await script(
                            scriptName,
                            scriptArguments,
                        );

                        if (exitCode !== 0) {
                            return exitCode;
                        }
                    }
                } finally {
                    process.chdir(previousDirectory);
                }

                return 0;
            }

            if (args[1] === "add") {
                const packageName = await addWorkspace(
                    requiredArgument(args[2], "workspace package name"),
                );

                console.log(
                    chalk.green(`Added workspace package ${packageName}`),
                );

                return 0;
            }

            throw new WizError(commandHelp("workspace").trim());
        }

        case "c":
            return compilerMain(args.slice(1));

        case "check":
            return compilerMain(["check", ...args.slice(1)]);

        case "watch":
            return compilerMain(["watch", "--run", ...args.slice(1)]);

        case "format":
        case "fmt":
            return compilerMain(["format", ...args.slice(1)]);

        case "lint":
            return compilerMain(["lint", ...args.slice(1)]);

        case "registry":
            return registryMain(args.slice(1));

        case "login":
            return loginMain(args.slice(1));

        case "logout":
            return logoutMain(args.slice(1));

        case "whoami":
            return whoamiMain(args.slice(1));

        case "publish":
            return publishMain(args.slice(1));

        case "deprecate":
            return deprecateMain(args.slice(1));

        case "search":
            return searchMain(args.slice(1));

        case "view":
            return viewMain(args.slice(1));

        case "org":
            return organizationMain(args.slice(1));

        default:
            throw new WizError(
                `Unknown command: ${command}\nRun wiz --help for usage.`,
            );
    }
}

if (import.meta.main) {
    try {
        process.exitCode = await main();
    } catch (err) {
        const message = err instanceof Error ? errorMessage(err) : String(err);

        console.error(`${chalk.bold.red("wiz:")} ${message}`);

        process.exitCode = err instanceof WizError ? err.exitCode : 1;
    }
}
