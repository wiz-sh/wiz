import type { CompilerOptions } from "../../compiler.ts";
import type { EmitResult } from "../../emission/emit-result.ts";
import type { LoweredProgram, ShellTargetBackend } from "../backend.ts";
import { printShell } from "../bash/printer.ts";
import { supportsShFeature } from "./capabilities.ts";

export const shBackend: ShellTargetBackend = {
    name: "sh",
    supports(feature): boolean {
        return supportsShFeature(feature);
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
                return printShell(file, options, "sh", program.checked);
            });
    },
};
