import type { AstNode } from "./ast-node.ts";
import type { SourceFile } from "./source-file.ts";

export interface DocumentationTag {
    name: string;
    parameter?: string;
    text: string;
}

export interface WizDocumentation {
    description: string;
    tags: readonly DocumentationTag[];
    markdown: string;
}

function documentationLines(file: SourceFile, node: AstNode): string[] {
    const before = file.text.slice(0, node.range.start);

    const lines = before.split(/\r?\n/);

    if (lines.at(-1)?.trim() === "") {
        lines.pop();
    }

    const result: string[] = [];

    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]?.trimStart() ?? "";

        if (!line.startsWith("##")) {
            break;
        }

        result.unshift(line.slice(2).replace(/^ /, ""));
    }

    return result;
}

function parseTag(line: string): DocumentationTag | undefined {
    const parameter = /^@param\s+([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/.exec(line);

    if (parameter !== null) {
        return {
            name: "param",
            text: parameter[2] ?? "",
            ...(parameter[1] === undefined ? {} : { parameter: parameter[1] }),
        };
    }

    const tag = /^@([A-Za-z][A-Za-z-]*)\s*(.*)$/.exec(line);

    if (tag === null) {
        return undefined;
    }

    return {
        name: tag[1] ?? "",
        text: tag[2] ?? "",
    };
}

function tagMarkdown(tag: DocumentationTag): string {
    if (tag.name === "param") {
        return `**Parameter \`${tag.parameter ?? ""}\`:** ${tag.text}`;
    }

    if (tag.name === "returns" || tag.name === "return") {
        return `**Returns:** ${tag.text}`;
    }

    if (tag.name === "example") {
        return `**Example:** \`${tag.text}\``;
    }

    return `**@${tag.name}:** ${tag.text}`;
}

/** Reads contiguous `##` comments immediately preceding a semantic node. */
export function getDocumentation(
    file: SourceFile,
    node: AstNode,
): WizDocumentation | undefined {
    const lines = documentationLines(file, node);

    if (lines.length === 0) {
        return undefined;
    }

    const description: string[] = [];

    const tags: DocumentationTag[] = [];

    for (const line of lines) {
        const tag = parseTag(line);

        if (tag === undefined) {
            description.push(line);
        } else {
            tags.push(tag);
        }
    }

    const summary = description.join("\n").trim();

    const sections = [summary, ...tags.map(tagMarkdown)].filter((section) => {
        return section !== "";
    });

    return {
        description: summary,
        tags,
        markdown: sections.join("\n\n"),
    };
}
