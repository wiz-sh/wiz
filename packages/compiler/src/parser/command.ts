import type {
    CommandArgument,
    CommandInvocation,
    CommandList,
    Pipeline,
    Redirection,
    ShellWord,
    ShellWordPart,
} from "../ast/source-file.ts";

interface Segment {
    start: number;
    end: number;
    operator?: string;
}

interface CommandSyntax {
    arguments: readonly CommandArgument[];
    list: CommandList;
}

const listOperators = new Set(["&&", "||", ";", "&"]);

const pipelineOperators = new Set(["|", "|&"]);

function balancedEnd(
    text: string,
    start: number,
    open: string,
    close: string,
): number {
    let depth = 1;

    let quote: string | undefined;

    for (let index = start + open.length; index < text.length; index += 1) {
        const character = text[index] ?? "";

        if (character === "\\") {
            index += 1;

            continue;
        }

        if (quote !== undefined) {
            if (character === quote) {
                quote = undefined;
            }

            continue;
        }

        if (character === "'" || character === '"') {
            quote = character;

            continue;
        }

        if (text.startsWith(open, index)) {
            depth += 1;

            index += open.length - 1;

            continue;
        }

        if (text.startsWith(close, index)) {
            depth -= 1;

            if (depth === 0) {
                return index + close.length;
            }

            index += close.length - 1;
        }
    }

    return text.length;
}

function wordParts(text: string, base: number): ShellWordPart[] {
    const parts: ShellWordPart[] = [];

    let start = 0;

    let quote: string | undefined;

    const push = (
        partKind: ShellWordPart["partKind"],
        from: number,
        to: number,
    ): void => {
        if (to <= from) {
            return;
        }

        parts.push({
            kind: "ShellWordPart",
            partKind,
            quoted: quote !== undefined,
            text: text.slice(from, to),
            range: { start: base + from, end: base + to },
        });
    };

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index] ?? "";

        if (character === "\\") {
            index += 1;

            continue;
        }

        if (character === "'" || character === '"') {
            if (quote === character) {
                quote = undefined;
            } else if (quote === undefined) {
                quote = character;
            }

            continue;
        }

        if (character !== "$" || quote === "'") {
            continue;
        }

        push("literal", start, index);

        let end: number;

        let partKind: ShellWordPart["partKind"];

        if (text.startsWith("$((", index)) {
            end = balancedEnd(text, index, "$((", "))");

            partKind = "arithmetic-expansion";
        } else if (text.startsWith("$(", index)) {
            end = balancedEnd(text, index, "$(", ")");

            partKind = "command-substitution";
        } else if (text.startsWith("${", index)) {
            end = balancedEnd(text, index, "${", "}");

            partKind = "parameter-expansion";
        } else {
            const match = /^\$[A-Za-z_][A-Za-z0-9_]*|^\$[0-9@*#?$!-]/.exec(
                text.slice(index),
            );

            end = index + (match?.[0].length ?? 1);

            partKind = "parameter-expansion";
        }

        push(partKind, index, end);

        index = end - 1;

        start = end;
    }

    push("literal", start, text.length);

    return parts;
}

function shellWord(
    text: string,
    start: number,
    end: number,
    base: number,
): ShellWord {
    const value = text.slice(start, end);

    return {
        kind: "ShellWord",
        parts: wordParts(value, base + start),
        text: value,
        range: { start: base + start, end: base + end },
    };
}

function words(text: string, base: number): ShellWord[] {
    const result: ShellWord[] = [];

    let start = -1;

    let quote: string | undefined;

    let expansionEnd = -1;

    for (let index = 0; index <= text.length; index += 1) {
        const character = text[index];

        if (index < expansionEnd) {
            continue;
        }

        if (character === "\\") {
            if (start < 0) {
                start = index;
            }

            index += 1;

            continue;
        }

        if (character === "'" || character === '"') {
            if (start < 0) {
                start = index;
            }

            if (quote === character) {
                quote = undefined;
            } else if (quote === undefined) {
                quote = character;
            }

            continue;
        }

        if (character === "$" && quote !== "'") {
            if (start < 0) {
                start = index;
            }

            if (text.startsWith("$((", index)) {
                expansionEnd = balancedEnd(text, index, "$((", "))");
            } else if (text.startsWith("$(", index)) {
                expansionEnd = balancedEnd(text, index, "$(", ")");
            } else if (text.startsWith("${", index)) {
                expansionEnd = balancedEnd(text, index, "${", "}");
            }

            continue;
        }

        if (
            (character === undefined || /\s/.test(character)) &&
            quote === undefined
        ) {
            if (start >= 0) {
                result.push(shellWord(text, start, index, base));

                start = -1;
            }

            continue;
        }

        if (start < 0) {
            start = index;
        }
    }

    return result;
}

function topLevelSegments(text: string): Segment[] {
    const result: Segment[] = [];

    let start = 0;

    let quote: string | undefined;

    let nestedUntil = -1;

    for (let index = 0; index < text.length; index += 1) {
        if (index < nestedUntil) {
            continue;
        }

        const character = text[index] ?? "";

        if (character === "\\") {
            index += 1;

            continue;
        }

        if (character === "'" || character === '"') {
            if (quote === character) {
                quote = undefined;
            } else if (quote === undefined) {
                quote = character;
            }

            continue;
        }

        if (quote !== "'" && text.startsWith("$((", index)) {
            nestedUntil = balancedEnd(text, index, "$((", "))");

            continue;
        }

        if (quote !== "'" && text.startsWith("$(", index)) {
            nestedUntil = balancedEnd(text, index, "$(", ")");

            continue;
        }

        if (quote !== "'" && text.startsWith("${", index)) {
            nestedUntil = balancedEnd(text, index, "${", "}");

            continue;
        }

        if (quote !== undefined) {
            continue;
        }

        const operator = ["&&", "||", "|&", ";", "|", "&"].find((candidate) => {
            return text.startsWith(candidate, index);
        });

        if (operator === undefined) {
            continue;
        }

        result.push({ start, end: index, operator });

        index += operator.length - 1;

        start = index + 1;
    }

    result.push({ start, end: text.length });

    return result;
}

function redirection(
    word: ShellWord,
    next?: ShellWord,
): Redirection | undefined {
    const match = /^(\d*)(<<-|<<<|>>|<<|<>|>&|<&|>|<)(.*)$/.exec(word.text);

    if (match === null) {
        return undefined;
    }

    const inlineTarget = match[3] ?? "";

    const target =
        inlineTarget.length > 0
            ? shellWord(
                  inlineTarget,
                  0,
                  inlineTarget.length,
                  word.range.end - inlineTarget.length,
              )
            : next;

    return {
        kind: "Redirection",
        ...(match[1] === "" ? {} : { descriptor: Number(match[1]) }),
        operator: match[2] as Redirection["operator"],
        ...(target === undefined ? {} : { target }),
        text: target === next ? `${word.text} ${next?.text ?? ""}` : word.text,
        range: {
            start: word.range.start,
            end: target?.range.end ?? word.range.end,
        },
    };
}

function invocation(
    text: string,
    start: number,
    end: number,
    base: number,
): CommandInvocation {
    const source = text.slice(start, end);

    const commandWords = words(source, base + start);

    const redirections: Redirection[] = [];

    const semanticWords: ShellWord[] = [];

    for (let index = 0; index < commandWords.length; index += 1) {
        const word = commandWords[index];

        if (word === undefined) {
            continue;
        }

        const parsed = redirection(word, commandWords[index + 1]);

        if (parsed === undefined) {
            semanticWords.push(word);

            continue;
        }

        redirections.push(parsed);

        if (/^\d*(?:<<-|<<<|>>|<<|<>|>&|<&|>|<)$/.test(word.text)) {
            index += 1;
        }
    }

    return {
        kind: "CommandInvocation",
        words: semanticWords,
        redirections,
        text: source,
        range: { start: base + start, end: base + end },
    };
}

/** Parses the compositional shell syntax of one logical command line. */
export function parseCommandSyntax(text: string, base: number): CommandSyntax {
    const segments = topLevelSegments(text);

    const pipelines: Pipeline[] = [];

    const listOperatorValues: CommandList["operators"][number][] = [];

    let commands: CommandInvocation[] = [];

    let pipelineOperatorValues: Pipeline["operators"][number][] = [];

    const finishPipeline = (): void => {
        if (commands.length === 0) {
            return;
        }

        const start = commands[0]?.range.start ?? base;

        const end = commands.at(-1)?.range.end ?? base + text.length;

        const firstWord = commands[0]?.words[0];

        pipelines.push({
            kind: "Pipeline",
            negated: firstWord?.text === "!",
            commands,
            operators: pipelineOperatorValues,
            text: text.slice(start - base, end - base),
            range: { start, end },
        });

        commands = [];

        pipelineOperatorValues = [];
    };

    for (const segment of segments) {
        if (text.slice(segment.start, segment.end).trim().length > 0) {
            commands.push(invocation(text, segment.start, segment.end, base));
        }

        if (
            segment.operator !== undefined &&
            pipelineOperators.has(segment.operator)
        ) {
            pipelineOperatorValues.push(segment.operator as "|" | "|&");

            continue;
        }

        if (
            segment.operator !== undefined &&
            listOperators.has(segment.operator)
        ) {
            finishPipeline();

            listOperatorValues.push(
                segment.operator as "&&" | "||" | ";" | "&",
            );
        }
    }

    finishPipeline();

    const list: CommandList = {
        kind: "CommandList",
        pipelines,
        operators: listOperatorValues,
        text,
        range: { start: base, end: base + text.length },
    };

    const first = pipelines[0]?.commands[0];

    const argumentsList = (first?.words ?? []).map((word) => {
        return {
            kind: "CommandArgument" as const,
            value: word.text,
            text: word.text,
            range: word.range,
        };
    });

    return { arguments: argumentsList, list };
}
