import type { Diagnostic } from "../diagnostics/diagnostic.ts";
import type { GreenNode } from "./green-node.ts";
import type { RedNode } from "./red-node.ts";
import type { SourceText } from "./source-text.ts";
import type { SyntaxToken } from "./token.ts";

export interface SyntaxTree {
    source: SourceText;
    green: GreenNode;
    root: RedNode;
    tokens: readonly SyntaxToken[];
    diagnostics: readonly Diagnostic[];
}
