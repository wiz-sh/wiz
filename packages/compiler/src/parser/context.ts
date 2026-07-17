import type { Diagnostic } from "../diagnostics/diagnostic.ts";
import type { SyntaxTree } from "../syntax/syntax-tree.ts";

export interface ParserContext {
    tree: SyntaxTree;
    diagnostics: Diagnostic[];
}

export function skipHorizontal(
    text: string,
    offset: number,
    end = text.length,
): number {
    let index = offset;

    while (
        index < end &&
        (text[index] === " " ||
            text[index] === "\t" ||
            text[index] === "\r" ||
            text[index] === "\n")
    ) {
        index += 1;
    }

    return index;
}

export function lineEnd(text: string, offset: number): number {
    const found = text.indexOf("\n", offset);

    return found < 0 ? text.length : found + 1;
}

/** Finds a structural delimiter while ignoring quoted and commented text. */
export function matching(
    text: string,
    openOffset: number,
    open: string,
    close: string,
): number | undefined {
    let depth = 1;

    let index = openOffset + 1;

    let quote: string | undefined;

    while (index < text.length) {
        const character = text[index] ?? "";

        if (character === "\\") {
            index += 2;

            continue;
        }

        if (quote !== undefined) {
            if (character === quote) {
                quote = undefined;
            }

            index += 1;

            continue;
        }

        if (character === "'" || character === '"') {
            quote = character;

            index += 1;

            continue;
        }

        if (
            character === "#" &&
            (index === 0 || /\s/.test(text[index - 1] ?? ""))
        ) {
            index = lineEnd(text, index);

            continue;
        }

        if (character === open) {
            depth += 1;
        } else if (character === close) {
            depth -= 1;

            if (depth === 0) {
                return index;
            }
        }

        index += 1;
    }

    return undefined;
}

export function splitParts(
    text: string,
    delimiter: string,
): Array<{ text: string; start: number }> {
    const result: Array<{ text: string; start: number }> = [];

    let start = 0;

    let angle = 0;

    let paren = 0;

    let quote: string | undefined;

    for (let index = 0; index <= text.length; index += 1) {
        const character = text[index];

        if (quote !== undefined) {
            if (character === quote && text[index - 1] !== "\\") {
                quote = undefined;
            }

            continue;
        }

        if (character === "'" || character === '"') {
            quote = character;

            continue;
        }

        if (character === "<") {
            angle += 1;
        } else if (character === ">") {
            angle = Math.max(0, angle - 1);
        } else if (character === "(") {
            paren += 1;
        } else if (character === ")") {
            paren = Math.max(0, paren - 1);
        }

        if (
            (character === delimiter || index === text.length) &&
            angle === 0 &&
            paren === 0
        ) {
            result.push({ text: text.slice(start, index), start });

            start = index + 1;
        }
    }

    return result;
}
