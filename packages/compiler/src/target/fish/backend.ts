import type { CompilerOptions } from "../../compiler.ts";
import type { EmitResult } from "../../emission/emit-result.ts";
import type { LoweredProgram, ShellTargetBackend } from "../backend.ts";
import { emitForeignShell } from "../foreign/emitter.ts";
import { supportsFishFeature } from "./capabilities.ts";

export const fishBackend: ShellTargetBackend = {
    name: "fish",
    supports: supportsFishFeature,
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
                return emitForeignShell(file, options, "fish");
            });
    },
};
