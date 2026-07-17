import { SyntaxKind } from "./syntax-kind.ts";
import type { SyntaxToken } from "./token.ts";

export interface GreenNode {
    kind: SyntaxKind.SourceFile;
    width: number;
    children: readonly SyntaxToken[];
}

export function createGreenSource(tokens: readonly SyntaxToken[]): GreenNode {
    return {
        kind: SyntaxKind.SourceFile,
        width: tokens.reduce((width, token) => {
            return width + token.text.length;
        }, 0),
        children: tokens,
    };
}
