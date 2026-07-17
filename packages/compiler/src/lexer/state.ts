import type { LexerMode } from "../syntax/syntax-kind.ts";

export interface LexerState {
    offset: number;
    mode: LexerMode;
    atCommandBoundary: boolean;
    heredocDelimiter?: string;
}

export function initialLexerState(): LexerState {
    return { offset: 0, mode: "command", atCommandBoundary: true };
}
