import type {
    CommandStatement,
    EnvironmentDeclaration,
    FunctionDeclaration,
    FunctionParameter,
    RawStatement,
    SourceFile,
    SourceImportDeclaration,
    Statement,
    TypedVariableDeclaration,
    TypeImportDeclaration,
} from "../ast/source-file.ts";
import { DiagnosticCodes } from "../diagnostics/codes.ts";
import type { Diagnostic } from "../diagnostics/diagnostic.ts";
import { lexSource } from "../lexer/lexer.ts";
import type { SyntaxTree } from "../syntax/syntax-tree.ts";
import { parseType, requiredType } from "../types/factory.ts";
import { parseCommandSyntax } from "./command.ts";
import { lineEnd, matching, skipHorizontal, splitParts } from "./context.ts";
import { parseExternalCommandDeclaration } from "./declaration.ts";

function unquoteShellWord(value: string): string {
    const quote = value[0];

    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
        return value.slice(1, -1);
    }

    return value;
}

function parseParameter(
    text: string,
    absoluteStart: number,
): FunctionParameter | undefined {
    const source = text.trim();

    if (source.length === 0) {
        return undefined;
    }

    let split = -1;

    let angle = 0;

    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];

        if (character === "<") {
            angle += 1;
        } else if (character === ">") {
            angle -= 1;
        } else if (/\s/.test(character ?? "") && angle === 0) {
            split = index;

            break;
        }
    }

    if (split < 0) {
        return undefined;
    }

    const type = parseType(source.slice(0, split));

    if (type === undefined) {
        return undefined;
    }

    const declaration = source.slice(split).trim();

    const equals = declaration.indexOf("=");

    const rawName = (
        equals < 0 ? declaration : declaration.slice(0, equals)
    ).trim();

    const rest = rawName.startsWith("...");

    const parameterName = rest ? rawName.slice(3) : rawName;

    const optional = rest || parameterName.endsWith("?") || equals >= 0;

    const name = parameterName.replace(/\?$/, "");

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        return undefined;
    }

    const leading = text.indexOf(source);

    const start = absoluteStart + Math.max(0, leading);

    return {
        kind: "FunctionParameter",
        name,
        type,
        optional,
        ...(rest ? { rest: true } : {}),
        ...(equals < 0
            ? {}
            : { defaultValue: declaration.slice(equals + 1).trim() }),
        range: { start, end: start + source.length },
        text: source,
    };
}

function typedDeclaration(
    line: string,
    start: number,
): TypedVariableDeclaration | undefined {
    const match =
        /^(\s*)(declare|local)\s+(-[A-Za-z]+)\s+((?:map<[^>\r\n]+>|[A-Za-z]+)(?:\[\])?\??)\s+([\s\S]*?)(?:\r?\n)?$/.exec(
            line,
        );

    if (match === null || !match[3]?.includes("T")) {
        return undefined;
    }

    const type = parseType(match[4] ?? "");

    if (type === undefined) {
        return undefined;
    }

    const subject = (match[5] ?? "").trim();

    const positional = /^['"]?\$([1-9][0-9]*)['"]?$/.exec(subject);

    const leading = match[1]?.length ?? 0;

    const nodeStart = start + leading;

    if (positional !== null) {
        return {
            kind: "TypedVariableDeclaration",
            command: match[2] as "declare" | "local",
            attributes: (match[3] ?? "").replace("T", ""),
            type,
            positionalParameter: Number(positional[1]),
            range: {
                start: nodeStart,
                end: start + line.replace(/\r?\n$/, "").length,
            },
            text: line,
        };
    }

    const variable = /^([A-Za-z_][A-Za-z0-9_]*)(?:=([\s\S]*))?$/.exec(subject);

    if (variable === null) {
        return undefined;
    }

    return {
        kind: "TypedVariableDeclaration",
        command: match[2] as "declare" | "local",
        attributes: (match[3] ?? "").replace("T", ""),
        type,
        name: variable[1] ?? "",
        ...(variable[2] === undefined ? {} : { initializer: variable[2] }),
        range: {
            start: nodeStart,
            end: start + line.replace(/\r?\n$/, "").length,
        },
        text: line,
    };
}

function parseEnvironment(
    line: string,
    start: number,
): EnvironmentDeclaration | undefined {
    const match =
        /^\s*declare\s+env\s+([A-Za-z_][A-Za-z0-9_]*)(\?)?\s*:\s*([^\s]+)\s*$/.exec(
            line,
        );

    const type = match === null ? undefined : parseType(match[3] ?? "");

    if (match === null || type === undefined) {
        return undefined;
    }

    return {
        kind: "EnvironmentDeclaration",
        name: match[1] ?? "",
        optional: match[2] !== undefined,
        type,
        text: line,
        range: { start, end: start + line.length },
    };
}

function raw(text: string, start: number, end: number): RawStatement {
    return {
        kind: "RawStatement",
        text: text.slice(start, end),
        range: { start, end },
    };
}

function parseStatements(
    text: string,
    rangeStart: number,
    rangeEnd: number,
    diagnostics: Diagnostic[],
    fileName: string,
): Statement[] {
    const statements: Statement[] = [];

    let offset = rangeStart;

    while (offset < rangeEnd) {
        const end = Math.min(lineEnd(text, offset), rangeEnd);

        const line = text.slice(offset, end);

        const commandDeclaration = parseExternalCommandDeclaration(
            text,
            offset,
            rangeEnd,
        );

        if (commandDeclaration !== undefined) {
            statements.push(commandDeclaration);

            offset = commandDeclaration.range.end;

            if (text[offset] === "\r") {
                offset += 1;
            }

            if (text[offset] === "\n") {
                offset += 1;
            }

            continue;
        }

        const declaration = typedDeclaration(line, offset);

        if (declaration !== undefined) {
            statements.push(declaration);

            offset = end;

            continue;
        }

        const env = parseEnvironment(line.trimEnd(), offset);

        if (env !== undefined) {
            statements.push(env);

            offset = end;

            continue;
        }

        const first = skipHorizontal(text, offset, end);

        const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(
            text.slice(first, end),
        );

        if (identifier !== null) {
            const name = identifier[0];

            const open = skipHorizontal(text, first + name.length, rangeEnd);

            if (text[open] === "(") {
                const close = matching(text, open, "(", ")");

                if (close !== undefined) {
                    let cursor = skipHorizontal(text, close + 1, rangeEnd);

                    let resultText = "status";

                    if (text[cursor] === ":") {
                        cursor = skipHorizontal(text, cursor + 1, rangeEnd);

                        const result = /^[A-Za-z][A-Za-z0-9_?[\]<> ,]*/.exec(
                            text.slice(cursor, rangeEnd),
                        );

                        resultText = result?.[0]?.trim() ?? "status";

                        cursor += result?.[0]?.length ?? 0;

                        cursor = skipHorizontal(text, cursor, rangeEnd);
                    }

                    if (text[cursor] === "{") {
                        const bodyClose = matching(text, cursor, "{", "}");

                        if (bodyClose === undefined) {
                            diagnostics.push({
                                code: DiagnosticCodes.unterminatedFunction,
                                message: `Unterminated function ${name}`,
                                severity: "error",
                                phase: "parser",
                                fileName,
                                range: { start: first, end: rangeEnd },
                            });

                            statements.push(raw(text, offset, rangeEnd));

                            break;
                        }

                        const parameters = splitParts(
                            text.slice(open + 1, close),
                            ",",
                        )
                            .map((part) => {
                                return parseParameter(
                                    part.text,
                                    open + 1 + part.start,
                                );
                            })
                            .filter(
                                (parameter): parameter is FunctionParameter => {
                                    return parameter !== undefined;
                                },
                            );

                        const rawParameters = text
                            .slice(open + 1, close)
                            .trim();

                        const typed =
                            rawParameters.length > 0 ||
                            text.slice(close + 1, cursor).includes(":");

                        const functionEnd = bodyClose + 1;

                        const bodyStart = cursor + 1;

                        const body = parseStatements(
                            text,
                            bodyStart,
                            bodyClose,
                            diagnostics,
                            fileName,
                        );

                        statements.push({
                            kind: "FunctionDeclaration",
                            name,
                            parameters,
                            resultType: requiredType(resultText),
                            typed,
                            bodyRange: { start: bodyStart, end: bodyClose },
                            bodyText: text.slice(bodyStart, bodyClose),
                            body,
                            text: text.slice(first, functionEnd),
                            range: { start: first, end: functionEnd },
                        } satisfies FunctionDeclaration);

                        offset = functionEnd;

                        if (text[offset] === "\r") {
                            offset += 1;
                        }

                        if (text[offset] === "\n") {
                            offset += 1;
                        }

                        continue;
                    }
                }
            }
        }

        const trimmed = line.trim();

        if (
            trimmed.length === 0 ||
            trimmed.startsWith("#") ||
            /^[{}]/.test(trimmed)
        ) {
            statements.push(raw(text, offset, end));
        } else {
            const leading = line.indexOf(trimmed);

            const commandSyntax = parseCommandSyntax(
                trimmed,
                offset + Math.max(0, leading),
            );

            const words = commandSyntax.arguments;

            const command = words[0];

            if (command === undefined) {
                statements.push(raw(text, offset, end));
            } else if (
                (command.value === "source" || command.value === ".") &&
                words[1]?.value === "-T" &&
                words[2] !== undefined
            ) {
                const argument = words[2];

                const quote =
                    argument.value[0] === '"' || argument.value[0] === "'"
                        ? argument.value[0]
                        : undefined;

                const specifier =
                    quote !== undefined && argument.value.endsWith(quote)
                        ? argument.value.slice(1, -1)
                        : argument.value;

                statements.push({
                    kind: "TypeImportDeclaration",
                    specifier,
                    text: line,
                    range: { start: offset, end },
                } satisfies TypeImportDeclaration);
            } else if (
                (command.value === "source" || command.value === ".") &&
                ["-I", "--import"].includes(words[1]?.value ?? "")
            ) {
                const separator = words.findIndex((word) => {
                    return word.value === "--";
                });

                const sourceIndex =
                    separator >= 0 ? separator + 1 : words.length - 1;

                const source = words[sourceIndex];

                const specifier =
                    source === undefined
                        ? undefined
                        : unquoteShellWord(source.value);

                const imported = words
                    .slice(2, separator >= 0 ? separator : sourceIndex)
                    .map((word) => {
                        return word.value;
                    });

                const invalid = imported.find((name) => {
                    return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
                });

                if (
                    source === undefined ||
                    specifier === undefined ||
                    specifier.includes("$") ||
                    specifier.includes("`") ||
                    !specifier.endsWith(".wiz") ||
                    imported.length === 0 ||
                    invalid !== undefined
                ) {
                    diagnostics.push({
                        code: DiagnosticCodes.invalidSourceImport,
                        message:
                            'Scoped source syntax is: source -I name [name...] -- "./module.wiz"',
                        severity: "error",
                        phase: "parser",
                        fileName,
                        range: { start: offset, end },
                    });

                    statements.push(raw(text, offset, end));
                } else {
                    statements.push({
                        kind: "SourceImportDeclaration",
                        specifier,
                        imports: imported,
                        text: line,
                        range: { start: offset, end },
                    } satisfies SourceImportDeclaration);
                }
            } else {
                statements.push({
                    kind: "CommandStatement",
                    name: command.value,
                    arguments: words.slice(1),
                    syntax: commandSyntax.list,
                    text: line,
                    range: { start: offset, end },
                } satisfies CommandStatement);
            }
        }

        offset = end;
    }

    return statements;
}

/** Converts a lossless syntax tree into the semantic AST used by later phases. */
export function parseSyntaxTree(tree: SyntaxTree): SourceFile {
    const diagnostics = [...tree.diagnostics];

    const text = tree.source.text;

    const statements = parseStatements(
        text,
        0,
        text.length,
        diagnostics,
        tree.source.fileName,
    );

    return {
        kind: "SourceFile",
        fileName: tree.source.fileName,
        text,
        declarationFile: tree.source.fileName.endsWith(".d.wiz"),
        syntaxTree: tree,
        statements,
        diagnostics,
    };
}

/** Lexes and parses one executable or declaration-only Wiz source file. */
export function parseSourceFile(
    text: string,
    fileName = "source.wiz",
): SourceFile {
    return parseSyntaxTree(lexSource(text, fileName));
}
