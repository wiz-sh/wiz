import type { AddOptions, AddRegistryOptions } from "@wiz/pm";
import { WizError } from "@wiz/pm";
import type { DlxOptions } from "@wiz/runtime";

export interface ParsedDlxArguments {
    options: DlxOptions;
    executableArgs: string[];
}

export interface ParsedInstallArguments {
    add?: AddOptions;
    registry?: AddRegistryOptions;
    workspace?: string;
    frozen: boolean;
    global: boolean;
}

export function requiredArgument(
    value: string | undefined,
    label: string,
): string {
    if (value === undefined || value.startsWith("-")) {
        throw new WizError(`Missing ${label}`);
    }

    return value;
}

export function parseDlxArguments(args: readonly string[]): ParsedDlxArguments {
    const repo = requiredArgument(args[1], "repository");

    const separator = args.indexOf("--");

    const end = separator < 0 ? args.length : separator;

    const executableArgs = separator < 0 ? [] : args.slice(separator + 1);

    let branch: string | undefined;

    let commit: string | undefined;

    let bin: string | undefined;

    let index = 2;

    while (index < end) {
        const value = args[index];

        if (value === "--branch") {
            branch = requiredArgument(args[index + 1], "branch");

            index += 2;

            continue;
        }

        if (value === "--commit") {
            commit = requiredArgument(args[index + 1], "commit");

            index += 2;

            continue;
        }

        if (value === "--bin") {
            bin = requiredArgument(args[index + 1], "bin name");

            index += 2;

            continue;
        }

        if (value !== undefined) {
            executableArgs.push(value);
        }

        index += 1;
    }

    return {
        options: {
            repo,
            ...(branch === undefined ? {} : { branch }),
            ...(commit === undefined ? {} : { commit }),
            ...(bin === undefined ? {} : { bin }),
        },
        executableArgs,
    };
}

export function parseInstallArguments(
    args: readonly string[],
): ParsedInstallArguments {
    let repo: string | undefined;

    let branch: string | undefined;

    let commit: string | undefined;

    let frozen = false;

    let global = false;

    let workspace: string | undefined;

    let index = 1;

    while (index < args.length) {
        const value = args[index];

        if (value === "--global" || value === "-g") {
            global = true;

            index += 1;

            continue;
        }

        if (value === "--frozen-lockfile") {
            frozen = true;

            index += 1;

            continue;
        }

        if (value === "--workspace") {
            workspace = requiredArgument(
                args[index + 1],
                "workspace package name",
            );

            index += 2;

            continue;
        }

        if (value === "--branch") {
            branch = requiredArgument(args[index + 1], "branch");

            index += 2;

            continue;
        }

        if (value === "--commit") {
            commit = requiredArgument(args[index + 1], "commit");

            index += 2;

            continue;
        }

        if (value?.startsWith("-")) {
            throw new WizError(`Unsupported install option: ${value}`);
        }

        if (value !== undefined && repo === undefined) {
            repo = value;

            index += 1;

            continue;
        }

        throw new WizError(`Unexpected install argument: ${value ?? ""}`);
    }

    if (repo === undefined && (branch !== undefined || commit !== undefined)) {
        throw new WizError("--branch and --commit require a repository");
    }

    if (repo !== undefined && global) {
        throw new WizError("Cannot add a dependency with --global");
    }

    if (repo !== undefined && frozen) {
        throw new WizError("Cannot add a dependency with --frozen-lockfile");
    }

    if (
        workspace !== undefined &&
        (repo !== undefined ||
            branch !== undefined ||
            commit !== undefined ||
            global ||
            frozen)
    ) {
        throw new WizError(
            "--workspace cannot be combined with repository or install mode options",
        );
    }

    const gitSource =
        repo !== undefined &&
        (/^(?:https?:\/\/|ssh:\/\/|git@|\.\.?\/|\/)/.test(repo) ||
            repo.endsWith(".git") ||
            branch !== undefined ||
            commit !== undefined);

    let registry: AddRegistryOptions | undefined;

    if (repo !== undefined && !gitSource) {
        const separator = repo.lastIndexOf("@");

        const scopedPrefix = repo.startsWith("@") ? 0 : -1;

        const hasVersion =
            separator > scopedPrefix && separator > repo.indexOf("/");

        registry = {
            name: hasVersion ? repo.slice(0, separator) : repo,
            ...(hasVersion ? { version: repo.slice(separator + 1) } : {}),
        };
    }

    return {
        frozen,
        global,
        ...(workspace === undefined ? {} : { workspace }),
        ...(registry === undefined ? {} : { registry }),
        ...(repo === undefined || !gitSource
            ? {}
            : {
                  add: {
                      repo,
                      ...(branch === undefined ? {} : { branch }),
                      ...(commit === undefined ? {} : { commit }),
                  },
              }),
    };
}
