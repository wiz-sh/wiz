import { lexSource } from "../lexer/lexer.ts";
import { SyntaxKind } from "../syntax/syntax-kind.ts";
import type { SyntaxToken } from "../syntax/token.ts";

function lines(tokens: readonly SyntaxToken[]): SyntaxToken[][] {
    const result: SyntaxToken[][] = [];

    let current: SyntaxToken[] = [];

    for (const token of tokens) {
        if (token.kind === SyntaxKind.EndOfFileToken) {
            continue;
        }

        current.push(token);

        if (
            token.kind === SyntaxKind.NewlineToken ||
            token.kind === SyntaxKind.HeredocBodyToken
        ) {
            result.push(current);

            current = [];
        }
    }

    if (current.length > 0) {
        result.push(current);
    }

    return result;
}

function minifyLine(tokens: readonly SyntaxToken[]): string {
    if (
        tokens.some((token) => {
            return token.kind === SyntaxKind.HeredocBodyToken;
        })
    ) {
        const body = tokens
            .map((token) => {
                return token.text;
            })
            .join("");

        return body.endsWith("\n") ? body.slice(0, -1) : body;
    }

    const pieces: string[] = [];

    let pendingSpace = false;

    for (const token of tokens) {
        if (token.kind === SyntaxKind.NewlineToken) {
            continue;
        }

        if (token.kind === SyntaxKind.CommentToken) {
            if (token.text.startsWith("#!") && pieces.length === 0) {
                pieces.push(token.text);
            }

            break;
        }

        if (token.kind === SyntaxKind.WhitespaceToken) {
            pendingSpace = pieces.length > 0;

            continue;
        }

        if (pendingSpace) {
            pieces.push(" ");

            pendingSpace = false;
        }

        pieces.push(token.text);
    }

    return pieces.join("");
}

/**
 * Removes comments, blank lines, indentation, and redundant horizontal space.
 * Command boundaries stay on separate lines because newlines can be semantic in shell.
 */
export function minifyShellSource(
    source: string,
    fileName = "source.sh",
): string {
    const syntax = lexSource(source, fileName);

    const output: string[] = [];

    for (const line of lines(syntax.tokens)) {
        const minified = minifyLine(line);

        if (minified !== "") {
            output.push(minified);
        }
    }

    return output.length === 0 ? "" : `${output.join("\n")}\n`;
}
