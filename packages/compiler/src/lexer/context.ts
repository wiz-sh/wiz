import type { Diagnostic } from "../diagnostics/diagnostic.ts";
import type { SourceText } from "../syntax/source-text.ts";
import type { SyntaxToken } from "../syntax/token.ts";
import type { LexerState } from "./state.ts";

export interface LexerContext {
    source: SourceText;
    state: LexerState;
    tokens: SyntaxToken[];
    diagnostics: Diagnostic[];
}
