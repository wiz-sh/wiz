import type { CompilerOptions } from "../../compiler.ts";
import type { EmitResult } from "../../emission/emit-result.ts";
import type { LoweredProgram, ShellTargetBackend } from "../backend.ts";
import { printShell } from "../bash/printer.ts";
import { supportsZshFeature } from "./capabilities.ts";

export const zshBackend: ShellTargetBackend = {
    name: "zsh",
    supports(feature): boolean {
        return supportsZshFeature(feature);
    },
    lower(program): LoweredProgram {
        return { checked: program };
    },
    emit(
        program: LoweredProgram,
        options: CompilerOptions,
    ): readonly EmitResult[] {
        return program.checked.sourceFiles
            .filter((file) => {
                return !file.declarationFile;
            })
            .map((file) => {
                return printShell(file, options, "zsh", program.checked);
            });
    },
};
