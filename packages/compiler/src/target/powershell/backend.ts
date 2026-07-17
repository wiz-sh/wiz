import type { CompilerOptions } from "../../compiler.ts";
import type { EmitResult } from "../../emission/emit-result.ts";
import type { LoweredProgram, ShellTargetBackend } from "../backend.ts";
import { emitForeignShell } from "../foreign/emitter.ts";
import { supportsPowerShellFeature } from "./capabilities.ts";

export const powerShellBackend: ShellTargetBackend = {
    name: "powershell",
    supports: supportsPowerShellFeature,
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
                return emitForeignShell(file, options, "powershell");
            });
    },
};
