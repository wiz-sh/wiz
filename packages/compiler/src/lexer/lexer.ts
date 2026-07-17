import { DiagnosticCodes } from "../diagnostics/codes.ts";
import type { Diagnostic } from "../diagnostics/diagnostic.ts";
import { createGreenSource } from "../syntax/green-node.ts";
import { RedNode } from "../syntax/red-node.ts";
import { SourceText } from "../syntax/source-text.ts";
import { type LexerMode, SyntaxKind } from "../syntax/syntax-kind.ts";
import type { SyntaxTree } from "../syntax/syntax-tree.ts";
import type { SyntaxToken } from "../syntax/token.ts";

const operators = [
    ";;&",
    "<<<",
    "<<-",
    "$(",
    "${",
    "((",
    "))",
    "[[",
    "]]",
    "&&",
    "||",
    "|&",
    ";;",
    ";&",
    "<<",
    ">>",
    "<=",
    ">=",
    "==",
    "!=",
    "=~",
    "++",
    "--",
    "+=",
    "-=",
    ";",
    "|",
    "&",
    "<",
    ">",
    "(",
    ")",
    "{",
    "}",
    "=",
    ":",
    ",",
] as const;

function matchingOperator(text: string, offset: number): string | undefined {
    return operators.find((operator) => {
        return text.startsWith(operator, offset);
    });
}

function readBalanced(
    text: string,
    start: number,
    open: string,
    close: string,
): number {
    let depth = 1;

    let index = start + open.length;

    let quote: "single" | "double" | undefined;

    while (index < text.length) {
        const character = text[index];

        if (character === "\\") {
            index += 2;

            continue;
        }

        if (quote === "single") {
            if (character === "'") {
                quote = undefined;
            }

            index += 1;

            continue;
        }

        if (quote === "double") {
            if (character === '"') {
                quote = undefined;
            }

            index += 1;

            continue;
        }

        if (character === "'") {
            quote = "single";

            index += 1;

            continue;
        }

        if (character === '"') {
            quote = "double";

            index += 1;

            continue;
        }

        if (text.startsWith(open, index)) {
            depth += 1;

            index += open.length;

            continue;
        }

        if (text.startsWith(close, index)) {
            depth -= 1;

            index += close.length;

            if (depth === 0) {
                return index;
            }

            continue;
        }

        index += 1;
    }

    return text.length;
}

function heredocDelimiter(
    text: string,
    operatorEnd: number,
): string | undefined {
    const lineEnd = text.indexOf("\n", operatorEnd);

    const end = lineEnd < 0 ? text.length : lineEnd;

    let index = operatorEnd;

    while (index < end && (text[index] === " " || text[index] === "\t")) {
        index += 1;
    }

    const quote =
        text[index] === "'" || text[index] === '"' ? text[index] : undefined;

    if (quote !== undefined) {
        index += 1;
    }

    const start = index;

    while (
        index < end &&
        (quote === undefined
            ? !/[\s;&|<>]/.test(text[index] ?? "")
            : text[index] !== quote)
    ) {
        index += 1;
    }

    return index === start ? undefined : text.slice(start, index);
}

/** Produces lossless tokens and recoverable diagnostics for compiler and editor use. */
export function lexSource(
    source: SourceText | string,
    fileName = "source.wiz",
): SyntaxTree {
    const sourceText =
        typeof source === "string" ? new SourceText(source, fileName) : source;

    const text = sourceText.text;

    const tokens: SyntaxToken[] = [];

    const diagnostics: Diagnostic[] = [];

    let offset = 0;

    let pendingHeredoc:
        | {
              delimiter: string;
              start: number;
          }
        | undefined;

    function push(
        kind: SyntaxKind,
        start: number,
        end: number,
        mode: LexerMode,
    ): void {
        const position = sourceText.positionAt(start);

        tokens.push({
            kind,
            text: text.slice(start, end),
            range: { start, end },
            line: position.line,
            column: position.column,
            mode,
        });
    }

    while (offset < text.length) {
        const start = offset;

        const character = text[offset] ?? "";

        if (character === "\n" || character === "\r") {
            if (character === "\r" && text[offset + 1] === "\n") {
                offset += 2;
            } else {
                offset += 1;
            }

            push(SyntaxKind.NewlineToken, start, offset, "command");

            if (pendingHeredoc !== undefined) {
                const pending = pendingHeredoc;

                const marker = pending.delimiter;

                const bodyStart = offset;

                let cursor = offset;

                let terminated = false;

                while (cursor < text.length) {
                    const next = text.indexOf("\n", cursor);

                    const lineEnd = next < 0 ? text.length : next;

                    if (
                        text.slice(cursor, lineEnd).replace(/\r$/, "") ===
                        marker
                    ) {
                        terminated = true;

                        break;
                    }

                    cursor = next < 0 ? text.length : next + 1;
                }

                if (cursor > bodyStart) {
                    push(
                        SyntaxKind.HeredocBodyToken,
                        bodyStart,
                        cursor,
                        "heredoc",
                    );

                    offset = cursor;
                }

                if (!terminated) {
                    diagnostics.push({
                        code: DiagnosticCodes.unterminatedHeredoc,
                        message: `Heredoc terminator was not found: ${marker}`,
                        severity: "error",
                        phase: "lexer",
                        fileName: sourceText.fileName,
                        range: { start: pending.start, end: text.length },
                    });
                }

                pendingHeredoc = undefined;
            }

            continue;
        }

        if (character === " " || character === "\t") {
            while (text[offset] === " " || text[offset] === "\t") {
                offset += 1;
            }

            push(SyntaxKind.WhitespaceToken, start, offset, "command");

            continue;
        }

        const previous = start === 0 ? "\n" : (text[start - 1] ?? "");

        if (character === "#" && (start === 0 || /[\s;|&]/.test(previous))) {
            const end = text.indexOf("\n", start);

            offset = end < 0 ? text.length : end;

            push(SyntaxKind.CommentToken, start, offset, "command");

            continue;
        }

        if (character === "'" || character === '"') {
            const quote = character;

            offset += 1;

            while (offset < text.length && text[offset] !== quote) {
                offset += text[offset] === "\\" && quote === '"' ? 2 : 1;
            }

            const terminated = text[offset] === quote;

            if (terminated) {
                offset += 1;
            } else {
                // The incomplete token remains in the tree so editor features still have text.
                diagnostics.push({
                    code: DiagnosticCodes.unterminatedQuote,
                    message: `Unterminated ${quote === "'" ? "single" : "double"} quote`,
                    severity: "error",
                    phase: "lexer",
                    fileName: sourceText.fileName,
                    range: { start, end: offset },
                });
            }

            push(
                quote === "'"
                    ? SyntaxKind.SingleQuotedToken
                    : SyntaxKind.DoubleQuotedToken,
                start,
                offset,
                quote === "'" ? "single-quoted" : "double-quoted",
            );

            continue;
        }

        if (text.startsWith("$((", start)) {
            offset = readBalanced(text, start, "$((", "))");

            push(SyntaxKind.ArithmeticToken, start, offset, "arithmetic");

            if (!text.slice(start, offset).endsWith("))")) {
                diagnostics.push({
                    code: DiagnosticCodes.unterminatedExpansion,
                    message: "Unterminated arithmetic expansion",
                    severity: "error",
                    phase: "lexer",
                    fileName: sourceText.fileName,
                    range: { start, end: offset },
                });
            }

            continue;
        }

        if (text.startsWith("$(", start)) {
            offset = readBalanced(text, start, "$(", ")");

            push(
                SyntaxKind.ExpansionToken,
                start,
                offset,
                "parameter-expansion",
            );

            if (!text.slice(start, offset).endsWith(")")) {
                diagnostics.push({
                    code: DiagnosticCodes.unterminatedExpansion,
                    message: "Unterminated command substitution",
                    severity: "error",
                    phase: "lexer",
                    fileName: sourceText.fileName,
                    range: { start, end: offset },
                });
            }

            continue;
        }

        if (text.startsWith("${", start)) {
            offset = readBalanced(text, start, "${", "}");

            push(
                SyntaxKind.ExpansionToken,
                start,
                offset,
                "parameter-expansion",
            );

            if (!text.slice(start, offset).endsWith("}")) {
                diagnostics.push({
                    code: DiagnosticCodes.unterminatedExpansion,
                    message: "Unterminated parameter expansion",
                    severity: "error",
                    phase: "lexer",
                    fileName: sourceText.fileName,
                    range: { start, end: offset },
                });
            }

            continue;
        }

        const operator = matchingOperator(text, start);

        if (operator !== undefined) {
            offset += operator.length;

            push(
                SyntaxKind.OperatorToken,
                start,
                offset,
                operator === "[["
                    ? "conditional"
                    : operator === "(("
                      ? "arithmetic"
                      : "command",
            );

            if (operator === "<<" || operator === "<<-") {
                const delimiter = heredocDelimiter(text, offset);

                if (delimiter !== undefined) {
                    pendingHeredoc = { delimiter, start };
                }
            }

            continue;
        }

        while (offset < text.length) {
            const next = text[offset] ?? "";

            if (
                /\s/.test(next) ||
                next === "'" ||
                next === '"' ||
                matchingOperator(text, offset) !== undefined
            ) {
                break;
            }

            offset += next === "\\" && offset + 1 < text.length ? 2 : 1;
        }

        if (offset === start) {
            offset += 1;

            push(SyntaxKind.BadToken, start, offset, "command");
        } else {
            const word = text.slice(start, offset);

            push(
                /^-?[0-9]+$/.test(word)
                    ? SyntaxKind.NumberToken
                    : SyntaxKind.WordToken,
                start,
                offset,
                "command",
            );
        }
    }

    push(SyntaxKind.EndOfFileToken, offset, offset, "command");

    const green = createGreenSource(tokens);

    return {
        source: sourceText,
        green,
        root: new RedNode(green),
        tokens,
        diagnostics,
    };
}
