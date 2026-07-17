import type { LexerMode, SyntaxKind } from "./syntax-kind.ts";
import type { TextRange } from "./text-range.ts";

export interface SyntaxToken {
    kind: SyntaxKind;
    text: string;
    range: TextRange;
    line: number;
    column: number;
    mode: LexerMode;
}

export function tokenEnd(token: SyntaxToken): number {
    return token.range.end;
}
