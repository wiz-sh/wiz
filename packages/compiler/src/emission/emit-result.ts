import type { Diagnostic } from "../diagnostics/diagnostic.ts";
import type { WizSourceMap } from "../source-map/types.ts";

export interface EmitResult {
    sourceFile: string;
    fileName: string;
    code: string;
    map?: WizSourceMap;
    mapText?: string;
}

export interface ProgramEmitResult {
    files: readonly EmitResult[];
    diagnostics: readonly Diagnostic[];
    emitSkipped: boolean;
}
