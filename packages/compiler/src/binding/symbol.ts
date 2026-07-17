import type { AstNode } from "../ast/ast-node.ts";
import type { WizType } from "../types/type.ts";
import type { SymbolFlags } from "./symbol-flags.ts";

/** A semantic declaration and all references bound to it. */
export interface WizSymbol {
    name: string;
    flags: SymbolFlags;
    type: WizType;
    declaration: AstNode;
    references: AstNode[];
}
