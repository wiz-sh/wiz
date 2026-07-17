import type { TextRange } from "../syntax/text-range.ts";

export type CompilerDiagnosticSeverity = "error" | "warning" | "information";
export type DiagnosticPhase =
    | "lexer"
    | "parser"
    | "binding"
    | "type"
    | "emit"
    | "project";

export interface Diagnostic {
    code: string;
    message: string;
    severity: CompilerDiagnosticSeverity;
    phase: DiagnosticPhase;
    fileName: string;
    range: TextRange;
}

export function diagnosticKey(diagnostic: Diagnostic): string {
    return `${diagnostic.fileName}:${diagnostic.range.start}:${diagnostic.range.end}:${diagnostic.code}`;
}

export function deduplicateDiagnostics(
    diagnostics: readonly Diagnostic[],
): Diagnostic[] {
    const seen = new Set<string>();

    return diagnostics.filter((diagnostic) => {
        const key = diagnosticKey(diagnostic);

        if (seen.has(key)) {
            return false;
        }

        seen.add(key);

        return true;
    });
}
