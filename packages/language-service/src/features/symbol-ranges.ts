import type { AstNode, TextRange } from "@wiz/compiler";

export function declarationNameRange(
    node: AstNode,
    name: string,
): TextRange | undefined {
    const pattern = new RegExp(`\\b${name}\\b`, "g");

    const searchText =
        node.kind === "FunctionDeclaration"
            ? node.text.slice(0, node.text.indexOf("(") + 1)
            : node.text.slice(
                  0,
                  node.text.indexOf("=") < 0
                      ? node.text.length
                      : node.text.indexOf("="),
              );

    const match = [...searchText.matchAll(pattern)].at(-1);

    if (match === undefined) {
        return undefined;
    }

    const start = node.range.start + match.index;

    return { start, end: start + name.length };
}
