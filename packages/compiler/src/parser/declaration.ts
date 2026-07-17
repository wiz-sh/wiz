import type {
    CommandOption,
    CommandSignature,
    ExternalCommandDeclaration,
    ExternalCommandMethod,
    FunctionParameter,
} from "../ast/source-file.ts";
import { parseType, requiredType } from "../types/factory.ts";
import { matching, skipHorizontal, splitParts } from "./context.ts";

function parseDeclarationParameter(
    text: string,
    absoluteStart: number,
): FunctionParameter | undefined {
    const source = text.trim();

    const colon = source.indexOf(":");

    if (colon < 1) {
        return undefined;
    }

    const declaredName = source.slice(0, colon).trim();

    const rest = declaredName.startsWith("...");

    const rawName = rest ? declaredName.slice(3) : declaredName;

    const rawType = source.slice(colon + 1).trim();

    const optional = rest || rawName.endsWith("?") || rawType.endsWith("?");

    const name = rawName.replace(/\?$/, "");

    const type = parseType(rawType.replace(/\?$/, ""));

    if (type === undefined || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        return undefined;
    }

    const start = absoluteStart + Math.max(0, text.indexOf(source));

    return {
        kind: "FunctionParameter",
        name,
        type,
        optional,
        ...(rest ? { rest: true } : {}),
        text: source,
        range: { start, end: start + source.length },
    };
}

function declarationParameters(
    text: string,
    absoluteStart: number,
): FunctionParameter[] {
    return splitParts(text, ",")
        .map((part) => {
            return parseDeclarationParameter(
                part.text,
                absoluteStart + part.start,
            );
        })
        .filter((parameter): parameter is FunctionParameter => {
            return parameter !== undefined;
        });
}

function commaList(value: string | undefined): string[] {
    if (value === undefined) {
        return [];
    }

    return value
        .split(",")
        .map((item) => {
            return item.trim();
        })
        .filter((item) => {
            return item.length > 0;
        });
}

function optionMetadata(
    line: string,
    start: number,
): CommandOption | undefined {
    const header = /^\s*option\s+/.exec(line);

    if (header === null) {
        return undefined;
    }

    let source = line.slice(header[0].length).trim();

    const subcommandMatch = /\s+for\s+([A-Za-z_][A-Za-z0-9_-]*)\s*$/.exec(
        source,
    );

    const subcommand = subcommandMatch?.[1];

    if (subcommandMatch !== null) {
        source = source.slice(0, subcommandMatch.index).trim();
    }

    const conflictsMatch = /\s+conflicts\(([^)]*)\)/.exec(source);

    const requiresMatch = /\s+requires\(([^)]*)\)/.exec(source);

    const conflicts = commaList(conflictsMatch?.[1]);

    const requires = commaList(requiresMatch?.[1]);

    source = source
        .replace(/\s+conflicts\([^)]*\)/, "")
        .replace(/\s+requires\([^)]*\)/, "")
        .trim();

    const required = /(?:^|\s)required(?:\s|$)/.test(source);

    const repeatable = /(?:^|\s)repeatable(?:\s|$)/.test(source);

    source = source
        .replace(/(?:^|\s)required(?=\s|$)/, " ")
        .replace(/(?:^|\s)repeatable(?=\s|$)/, " ")
        .trim();

    const valueMatch = /\s*<([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^>]+)>\s*$/.exec(
        source,
    );

    const valueName = valueMatch?.[1];

    const valueType =
        valueMatch === null ? undefined : parseType(valueMatch[2] ?? "");

    if (valueMatch !== null) {
        source = source.slice(0, valueMatch.index).trim();
    }

    const names = source
        .split(",")
        .map((name) => {
            return name.trim();
        })
        .filter((name) => {
            return /^-{1,2}[A-Za-z0-9][A-Za-z0-9-]*$/.test(name);
        });

    if (
        names.length === 0 ||
        (valueMatch !== null && valueType === undefined)
    ) {
        return undefined;
    }

    const optionStart = start + line.indexOf("option");

    return {
        kind: "CommandOption",
        names,
        ...(valueName === undefined ? {} : { valueName }),
        ...(valueType === undefined ? {} : { valueType }),
        required,
        repeatable,
        conflicts,
        requires,
        ...(subcommand === undefined ? {} : { subcommand }),
        text: line,
        range: {
            start: optionStart,
            end: start + line.trimEnd().length,
        },
    };
}

function commandOptions(body: string, bodyStart: number): CommandOption[] {
    const options: CommandOption[] = [];

    let offset = 0;

    for (const line of body.split(/(?<=\n)/)) {
        const option = optionMetadata(line, bodyStart + offset);

        if (option !== undefined) {
            options.push(option);
        }

        offset += line.length;
    }

    return options;
}

function commandOverloads(
    body: string,
    bodyStart: number,
    subcommand?: string,
): CommandSignature[] {
    const signatures: CommandSignature[] = [];

    const pattern =
        /\boverload(?:\s+([A-Za-z_][A-Za-z0-9_-]*))?\s*\(([^)]*)\)\s*:\s*([^\s;\r\n]+)/g;

    for (const match of body.matchAll(pattern)) {
        if ((match[1] ?? undefined) !== subcommand) {
            continue;
        }

        const start = bodyStart + match.index;

        const parametersText = match[2] ?? "";

        const parameterStart = start + (match[0]?.indexOf("(") ?? 0) + 1;

        signatures.push({
            kind: "CommandSignature",
            parameters: declarationParameters(parametersText, parameterStart),
            resultType: requiredType(match[3] ?? "status"),
            text: match[0] ?? "",
            range: {
                start,
                end: start + (match[0]?.length ?? 0),
            },
        });
    }

    return signatures;
}

function directDeclaration(
    text: string,
    start: number,
    name: string,
    open: number,
): ExternalCommandDeclaration | undefined {
    const close = matching(text, open, "(", ")");

    if (close === undefined) {
        return undefined;
    }

    let cursor = skipHorizontal(text, close + 1);

    if (text[cursor] !== ":") {
        return undefined;
    }

    cursor = skipHorizontal(text, cursor + 1);

    const result = /^[A-Za-z][A-Za-z0-9_?[\]]*/.exec(text.slice(cursor));

    if (result === null) {
        return undefined;
    }

    const end = cursor + result[0].length;

    return {
        kind: "ExternalCommandDeclaration",
        name,
        direct: true,
        parameters: declarationParameters(
            text.slice(open + 1, close),
            open + 1,
        ),
        resultType: requiredType(result[0]),
        methods: [],
        text: text.slice(start, end),
        range: { start, end },
    };
}

function blockDeclaration(
    text: string,
    start: number,
    name: string,
    open: number,
): ExternalCommandDeclaration | undefined {
    const close = matching(text, open, "{", "}");

    if (close === undefined) {
        return undefined;
    }

    const body = text.slice(open + 1, close);

    const bodyStart = open + 1;

    const options = commandOptions(body, bodyStart);

    const overloads = commandOverloads(body, bodyStart);

    const methods: ExternalCommandMethod[] = [];

    const pattern =
        /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*\(([^)\r\n]*)\)\s*:\s*([A-Za-z][A-Za-z0-9_?[\]]*)/gm;

    for (const method of body.matchAll(pattern)) {
        if (method[1] === "overload") {
            continue;
        }

        const methodStart = open + 1 + method.index;

        const parametersText = method[2] ?? "";

        const parameterBase = methodStart + (method[0]?.indexOf("(") ?? 0) + 1;

        methods.push({
            kind: "ExternalCommandMethod",
            name: method[1] ?? "",
            parameters: declarationParameters(parametersText, parameterBase),
            resultType: requiredType(method[3] ?? "status"),
            options: options.filter((option) => {
                return option.subcommand === method[1];
            }),
            overloads: commandOverloads(body, bodyStart, method[1]),
            text: method[0] ?? "",
            range: {
                start: methodStart,
                end: methodStart + (method[0]?.length ?? 0),
            },
        });
    }

    const direct = methods.length === 0 && overloads.length > 0;

    const primary = overloads[0];

    return {
        kind: "ExternalCommandDeclaration",
        name,
        direct,
        parameters: primary?.parameters ?? [],
        resultType: primary?.resultType ?? requiredType("status"),
        methods,
        options: options.filter((option) => {
            return option.subcommand === undefined;
        }),
        overloads: direct ? overloads.slice(1) : overloads,
        text: text.slice(start, close + 1),
        range: { start, end: close + 1 },
    };
}

/** Parses direct command signatures and subcommand declaration blocks. */
export function parseExternalCommandDeclaration(
    text: string,
    start: number,
    rangeEnd: number,
): ExternalCommandDeclaration | undefined {
    const header = /^\s*declare\s+command\s+([A-Za-z_][A-Za-z0-9_.+-]*)/.exec(
        text.slice(start, rangeEnd),
    );

    if (header === null) {
        return undefined;
    }

    const name = header[1] ?? "";

    const headerEnd = start + (header[0]?.length ?? 0);

    const open = skipHorizontal(text, headerEnd, rangeEnd);

    if (text[open] === "(") {
        return directDeclaration(text, start, name, open);
    }

    if (text[open] === "{") {
        return blockDeclaration(text, start, name, open);
    }

    return undefined;
}
