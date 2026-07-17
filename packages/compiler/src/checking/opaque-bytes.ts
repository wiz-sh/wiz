import type { SourceFile, Statement } from "../ast/source-file.ts";
import type { BindingResult } from "../binding/binder.ts";
import { DiagnosticCodes } from "../diagnostics/codes.ts";
import type { Diagnostic } from "../diagnostics/diagnostic.ts";

/** Prevents the backing path of a byte handle from masquerading as its payload. */
export function checkOpaqueBytesUsage(
    statement: Extract<Statement, { kind: "CommandStatement" }>,
    file: SourceFile,
    binding: BindingResult,
    diagnostics: Diagnostic[],
): void {
    if (statement.name === "bytes") {
        return;
    }

    const scope = binding.nodeScopes.get(statement) ?? binding.globalScope;

    const expansion = /\$(?:\{)?([A-Za-z_][A-Za-z0-9_]*)/g;

    for (const match of statement.text.matchAll(expansion)) {
        const symbol = scope.resolve(match[1] ?? "");

        if (symbol?.type.name !== "bytes") {
            continue;
        }

        diagnostics.push({
            code: DiagnosticCodes.opaqueBytesUsage,
            message: `Bytes value ${symbol.name} is opaque; use bytes emit, pipe, save, length, or dispose`,
            severity: "error",
            phase: "type",
            fileName: file.fileName,
            range: {
                start: statement.range.start + (match.index ?? 0),
                end:
                    statement.range.start +
                    (match.index ?? 0) +
                    match[0].length,
            },
        });
    }
}
