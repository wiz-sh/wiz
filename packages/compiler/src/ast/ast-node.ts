import type { TextRange } from "../syntax/text-range.ts";

export interface AstNode {
    kind: string;
    range: TextRange;
    text: string;
}
