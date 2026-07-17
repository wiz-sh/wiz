import coreutilsSource from "../../../wiz/types/coreutils/index.d.wiz" with {
    type: "text",
};
import bashSource from "../../../wiz/types/shell/bash.d.wiz" with {
    type: "text",
};
import cmdSource from "../../../wiz/types/shell/cmd.d.wiz" with {
    type: "text",
};
import fishSource from "../../../wiz/types/shell/fish.d.wiz" with {
    type: "text",
};
import powershellSource from "../../../wiz/types/shell/powershell.d.wiz" with {
    type: "text",
};
import shSource from "../../../wiz/types/shell/sh.d.wiz" with { type: "text" };
import zshSource from "../../../wiz/types/shell/zsh.d.wiz" with {
    type: "text",
};
import wizSource from "../../../wiz/types/wiz/index.d.wiz" with {
    type: "text",
};
import type { SourceFile } from "./ast/source-file.ts";
import { bindSourceFile } from "./binding/binder.ts";
import { Scope } from "./binding/scope.ts";
import { parseSourceFile } from "./parser/parser.ts";

export type StandardLibraryName =
    | "shell/bash"
    | "shell/zsh"
    | "shell/sh"
    | "shell/fish"
    | "shell/powershell"
    | "shell/cmd"
    | "coreutils"
    | "wiz";

export interface StandardLibraryFile {
    name: StandardLibraryName;
    file: SourceFile;
}

const parsedFiles: Readonly<Record<StandardLibraryName, SourceFile>> = {
    "shell/bash": parseSourceFile(bashSource, "wiz:types/shell/bash.d.wiz"),
    "shell/zsh": parseSourceFile(zshSource, "wiz:types/shell/zsh.d.wiz"),
    "shell/sh": parseSourceFile(shSource, "wiz:types/shell/sh.d.wiz"),
    "shell/fish": parseSourceFile(fishSource, "wiz:types/shell/fish.d.wiz"),
    "shell/powershell": parseSourceFile(
        powershellSource,
        "wiz:types/shell/powershell.d.wiz",
    ),
    "shell/cmd": parseSourceFile(cmdSource, "wiz:types/shell/cmd.d.wiz"),
    coreutils: parseSourceFile(
        coreutilsSource,
        "wiz:types/coreutils/index.d.wiz",
    ),
    wiz: parseSourceFile(wizSource, "wiz:types/wiz/index.d.wiz"),
};

export const defaultStandardLibraries: readonly StandardLibraryName[] = [
    "shell/bash",
    "coreutils",
    "wiz",
];

export function standardLibrariesForTarget(
    target: "bash" | "zsh" | "sh" | "fish" | "powershell" | "cmd" = "bash",
): readonly StandardLibraryName[] {
    const shell = `shell/${target}` as StandardLibraryName;

    return [shell, "coreutils", "wiz"];
}

/** Parses the bundled ambient declarations used by compiler and editor projects. */
export function getStandardLibraryFiles(
    names: readonly StandardLibraryName[] = defaultStandardLibraries,
): readonly StandardLibraryFile[] {
    return names.map((name) => {
        return {
            name,
            file: parsedFiles[name],
        };
    });
}

/** Creates a parent scope so project declarations can safely override ambient APIs. */
export function createStandardLibraryScope(
    names: readonly StandardLibraryName[] = defaultStandardLibraries,
): Scope {
    const scope = new Scope();

    for (const library of getStandardLibraryFiles(names)) {
        bindSourceFile(library.file, scope);
    }

    return scope;
}
