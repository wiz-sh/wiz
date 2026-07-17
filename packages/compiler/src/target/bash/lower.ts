import type { CheckedProgram, CompilerOptions } from "../../compiler.ts";
import type { EmitResult } from "../../emission/emit-result.ts";
import type { LoweredProgram, ShellTargetBackend } from "../backend.ts";
import type { LanguageFeature } from "../target.ts";
import { supportsBashFeature } from "./capabilities.ts";
import { printBash } from "./printer.ts";

export const bashBackend: ShellTargetBackend = {
    name: "bash",
    supports(feature: LanguageFeature): boolean {
        return supportsBashFeature(feature);
    },
    lower(program: CheckedProgram): LoweredProgram {
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
                return printBash(file, options, program.checked);
            });
    },
};
