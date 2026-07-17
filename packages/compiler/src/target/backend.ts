import type { CheckedProgram, CompilerOptions } from "../compiler.ts";
import type { EmitResult } from "../emission/emit-result.ts";
import type { LanguageFeature } from "./target.ts";

export type ShellTargetName =
    | "bash"
    | "zsh"
    | "sh"
    | "fish"
    | "powershell"
    | "cmd";

export interface LoweredProgram {
    checked: CheckedProgram;
}

/** Stable boundary between checked Wiz semantics and a concrete shell target. */
export interface ShellTargetBackend {
    readonly name: ShellTargetName;
    supports(feature: LanguageFeature): boolean;
    lower(program: CheckedProgram, options: CompilerOptions): LoweredProgram;
    emit(
        program: LoweredProgram,
        options: CompilerOptions,
    ): readonly EmitResult[];
}
