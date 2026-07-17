import {
    minifyShellSource,
    type SourceFile,
    SyntaxKind,
    type SyntaxToken,
} from "@wiz/compiler";
import type { FormatOptions } from "./options.ts";
import { defaultFormatOptions } from "./options.ts";
import type { FormatRange } from "./range.ts";

function commandAt(
    file: SourceFile,
    start: number,
    end: number,
):
    | Extract<SourceFile["statements"][number], { kind: "CommandStatement" }>
    | undefined {
    const statement = file.statements.find((candidate) => {
        return (
            candidate.kind === "CommandStatement" &&
            candidate.range.start <= start &&
            candidate.range.end >= end
        );
    });

    return statement?.kind === "CommandStatement" ? statement : undefined;
}

function isTrivia(token: SyntaxToken): boolean {
    return (
        token.kind === SyntaxKind.WhitespaceToken ||
        token.kind === SyntaxKind.NewlineToken
    );
}

function lineTokens(tokens: readonly SyntaxToken[]): SyntaxToken[][] {
    const lines: SyntaxToken[][] = [];

    let current: SyntaxToken[] = [];

    for (const token of tokens) {
        if (token.kind === SyntaxKind.EndOfFileToken) {
            continue;
        }

        current.push(token);

        if (token.kind === SyntaxKind.NewlineToken) {
            lines.push(current);

            current = [];
        } else if (token.kind === SyntaxKind.HeredocBodyToken) {
            lines.push(current);

            current = [];
        }
    }

    if (current.length > 0) {
        lines.push(current);
    }

    return lines;
}

function significant(tokens: readonly SyntaxToken[]): SyntaxToken[] {
    return tokens.filter((token) => {
        return !isTrivia(token);
    });
}

function beginsWithClose(tokens: readonly SyntaxToken[]): boolean {
    const first = significant(tokens)[0]?.text;

    return (
        first === "fi" ||
        first === "done" ||
        first === "esac" ||
        first === "}" ||
        first === "else" ||
        first === "elif"
    );
}

function opensBlock(tokens: readonly SyntaxToken[]): boolean {
    const values = significant(tokens).map((token) => {
        return token.text;
    });

    const first = values[0];

    const last = values.at(-1);

    if (last === "{") {
        return true;
    }

    if (first === "case") {
        return true;
    }

    return (
        values.includes("then") ||
        values.includes("do") ||
        first === "else" ||
        first === "elif"
    );
}

function continuesCommand(tokens: readonly SyntaxToken[]): boolean {
    const last = significant(tokens).at(-1)?.text;

    return ["|", "|&", "&&", "||", "\\"].includes(last ?? "");
}

function leadingEnd(tokens: readonly SyntaxToken[]): number {
    let index = 0;

    while (tokens[index]?.kind === SyntaxKind.WhitespaceToken) {
        index += 1;
    }

    return index;
}

function formatLine(
    tokens: readonly SyntaxToken[],
    indent: string,
    shouldIndent: boolean,
): string {
    if (
        tokens.some((token) => {
            return token.kind === SyntaxKind.HeredocBodyToken;
        })
    ) {
        return tokens
            .map((token) => {
                return token.text;
            })
            .join("");
    }

    const newline =
        tokens.at(-1)?.kind === SyntaxKind.NewlineToken
            ? (tokens.at(-1)?.text ?? "\n")
            : "";

    const contentEnd = newline === "" ? tokens.length : tokens.length - 1;

    let end = contentEnd;

    while (end > 0 && tokens[end - 1]?.kind === SyntaxKind.WhitespaceToken) {
        end -= 1;
    }

    const start = leadingEnd(tokens);

    const content = tokens
        .slice(start, end)
        .map((token) => {
            return token.text;
        })
        .join("");

    if (content.length === 0) {
        return newline;
    }

    if (content.startsWith("#!")) {
        return `${content}${newline}`;
    }

    return `${shouldIndent ? indent : ""}${content}${newline}`;
}

function wrapCommandLine(
    source: string,
    statement: Extract<
        SourceFile["statements"][number],
        { kind: "CommandStatement" }
    >,
    indent: string,
    unit: string,
    lineWidth: number,
): string {
    if (
        statement.syntax === undefined ||
        source.length + indent.length <= lineWidth ||
        source.includes("\n") ||
        source.trimStart().startsWith("#")
    ) {
        return `${indent}${source.trimStart()}`;
    }

    const operators: Array<{ offset: number; value: string }> = [];

    for (const pipeline of statement.syntax.pipelines) {
        for (let index = 0; index < pipeline.operators.length; index += 1) {
            const command = pipeline.commands[index];

            const value = pipeline.operators[index];

            if (command !== undefined && value !== undefined) {
                operators.push({
                    offset: command.range.end - statement.range.start,
                    value,
                });
            }
        }
    }

    for (let index = 0; index < statement.syntax.operators.length; index += 1) {
        const pipeline = statement.syntax.pipelines[index];

        const value = statement.syntax.operators[index];

        if (pipeline !== undefined && value !== undefined) {
            operators.push({
                offset: pipeline.range.end - statement.range.start,
                value,
            });
        }
    }

    if (operators.length === 0) {
        return `${indent}${source.trimStart()}`;
    }

    let result = "";

    let cursor = 0;

    const continuation = `${indent}${unit}`;

    for (const operator of operators.toSorted((left, right) => {
        return left.offset - right.offset;
    })) {
        const operatorStart = source.indexOf(operator.value, cursor);

        if (operatorStart < 0) {
            continue;
        }

        const before = source.slice(cursor, operatorStart).trim();

        result += `${result === "" ? indent : ""}${before} ${operator.value}\n${continuation}`;

        cursor = operatorStart + operator.value.length;
    }

    result += source.slice(cursor).trim();

    return result;
}

/** Formats compiler tokens while preserving quotes, comments, and heredoc bodies. */
export function formatSourceFile(
    file: SourceFile,
    options: FormatOptions = {},
    range?: FormatRange,
): string {
    const resolved = { ...defaultFormatOptions, ...options };

    const unit =
        resolved.indentStyle === "tab"
            ? "\t"
            : " ".repeat(resolved.indentWidth);

    let depth = 0;

    let continued = false;

    let output = "";

    for (const tokens of lineTokens(file.syntaxTree.tokens)) {
        const start = tokens[0]?.range.start ?? 0;

        const end = tokens.at(-1)?.range.end ?? start;

        const outsideRange =
            range !== undefined && (end <= range.start || start >= range.end);

        if (beginsWithClose(tokens)) {
            depth = Math.max(0, depth - 1);
        }

        if (outsideRange) {
            output += tokens
                .map((token) => {
                    return token.text;
                })
                .join("");
        } else {
            const indentation = unit.repeat(depth + (continued ? 1 : 0));

            const formatted = formatLine(tokens, indentation, depth > 0);

            const newline = formatted.endsWith("\n") ? "\n" : "";

            const content = newline === "" ? formatted : formatted.slice(0, -1);

            const statement = commandAt(file, start, end);

            output +=
                statement === undefined
                    ? formatted
                    : `${wrapCommandLine(
                          content,
                          statement,
                          indentation,
                          unit,
                          resolved.lineWidth,
                      )}${newline}`;
        }

        if (opensBlock(tokens)) {
            depth += 1;
        }

        continued = continuesCommand(tokens);

        const first = significant(tokens)[0]?.text;

        if (first === "else" || first === "elif") {
            depth = Math.max(1, depth);
        }
    }

    if (range !== undefined) {
        return output;
    }

    while (output.endsWith("\n") || output.endsWith("\r")) {
        output = output.slice(0, -1);
    }

    return resolved.trailingNewline ? `${output}\n` : output;
}

/** Produces compact shell while retaining syntax-sensitive command boundaries. */
export function minifySourceFile(file: SourceFile): string {
    return minifyShellSource(file.text, file.fileName);
}
