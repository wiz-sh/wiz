import { type Statement, SyntaxKind, type TextRange } from "@wiz/compiler";
import type { DocumentSnapshot } from "../snapshot.ts";
import { declarationNameRange } from "./symbol-ranges.ts";

export interface SemanticTokenInfo {
    range: TextRange;
    type:
        | "comment"
        | "function"
        | "number"
        | "operator"
        | "parameter"
        | "string"
        | "variable";
}

function rangesOverlap(left: TextRange, right: TextRange): boolean {
    return left.start < right.end && right.start < left.end;
}

function replaceToken(
    tokens: SemanticTokenInfo[],
    token: SemanticTokenInfo,
): void {
    for (let index = tokens.length - 1; index >= 0; index -= 1) {
        const existing = tokens[index];

        if (
            existing !== undefined &&
            rangesOverlap(existing.range, token.range)
        ) {
            tokens.splice(index, 1);
        }
    }

    tokens.push(token);
}

function addDeclarationTokens(
    tokens: SemanticTokenInfo[],
    statements: readonly Statement[],
): void {
    for (const statement of statements) {
        if (
            statement.kind === "TypedVariableDeclaration" ||
            statement.kind === "EnvironmentDeclaration"
        ) {
            if (statement.name !== undefined) {
                const variableRange = declarationNameRange(
                    statement,
                    statement.name,
                );

                if (variableRange !== undefined) {
                    replaceToken(tokens, {
                        range: variableRange,
                        type: "variable",
                    });
                }
            }

            continue;
        }

        if (statement.kind === "FunctionDeclaration") {
            const nameRange = declarationNameRange(statement, statement.name);

            if (nameRange !== undefined) {
                replaceToken(tokens, {
                    range: nameRange,
                    type: "function",
                });
            }

            for (const parameter of statement.parameters) {
                const parameterRange = declarationNameRange(
                    parameter,
                    parameter.name,
                );

                if (parameterRange !== undefined) {
                    replaceToken(tokens, {
                        range: parameterRange,
                        type: "parameter",
                    });
                }
            }

            addDeclarationTokens(tokens, statement.body);

            continue;
        }

        if (statement.kind !== "ExternalCommandDeclaration") {
            continue;
        }

        const nameRange = declarationNameRange(statement, statement.name);

        if (nameRange !== undefined) {
            replaceToken(tokens, {
                range: nameRange,
                type: "function",
            });
        }

        for (const signature of [statement, ...statement.methods]) {
            if (signature.kind === "ExternalCommandMethod") {
                const methodRange = declarationNameRange(
                    signature,
                    signature.name,
                );

                if (methodRange !== undefined) {
                    replaceToken(tokens, {
                        range: methodRange,
                        type: "function",
                    });
                }
            }

            for (const parameter of signature.parameters) {
                const parameterRange = declarationNameRange(
                    parameter,
                    parameter.name,
                );

                if (parameterRange !== undefined) {
                    replaceToken(tokens, {
                        range: parameterRange,
                        type: "parameter",
                    });
                }
            }
        }
    }
}

/** Produces non-overlapping tokens, preferring semantic declarations to lexer roles. */
export function collectSemanticTokens(
    snapshot: DocumentSnapshot,
): readonly SemanticTokenInfo[] {
    const tokens: SemanticTokenInfo[] = snapshot.file.syntaxTree.tokens.flatMap(
        (token) => {
            const type =
                token.kind === SyntaxKind.CommentToken
                    ? "comment"
                    : token.kind === SyntaxKind.SingleQuotedToken ||
                        token.kind === SyntaxKind.DoubleQuotedToken
                      ? "string"
                      : token.kind === SyntaxKind.NumberToken
                        ? "number"
                        : token.kind === SyntaxKind.OperatorToken
                          ? "operator"
                          : undefined;

            return type === undefined ? [] : [{ range: token.range, type }];
        },
    );

    addDeclarationTokens(tokens, snapshot.file.statements);

    const expansion = /\$(?:\{)?([A-Za-z_][A-Za-z0-9_]*)/g;

    for (const match of snapshot.text.matchAll(expansion)) {
        const start = match.index + (match[0]?.indexOf(match[1] ?? "") ?? 0);

        const containing = snapshot.file.syntaxTree.tokens.find((token) => {
            return start >= token.range.start && start < token.range.end;
        });

        if (
            containing?.kind === SyntaxKind.SingleQuotedToken ||
            containing?.kind === SyntaxKind.DoubleQuotedToken
        ) {
            continue;
        }

        replaceToken(tokens, {
            range: { start, end: start + (match[1]?.length ?? 0) },
            type: "variable",
        });
    }

    return tokens.toSorted((left, right) => {
        return left.range.start - right.range.start;
    });
}
