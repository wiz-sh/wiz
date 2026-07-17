import type { GreenNode } from "./green-node.ts";
import type { SyntaxToken } from "./token.ts";

export class RedNode {
    readonly green: GreenNode;
    readonly parent: RedNode | undefined;
    readonly offset: number;

    constructor(green: GreenNode, parent?: RedNode, offset = 0) {
        this.green = green;

        this.parent = parent;

        this.offset = offset;
    }

    tokenAt(offset: number): SyntaxToken | undefined {
        return this.green.children.find((token) => {
            return offset >= token.range.start && offset <= token.range.end;
        });
    }
}
