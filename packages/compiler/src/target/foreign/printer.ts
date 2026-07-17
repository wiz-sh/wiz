import type {
    CommandArgument,
    CommandInvocation,
    FunctionDeclaration,
    Statement,
} from "../../ast/source-file.ts";
import { cmdControl, cmdLoopFooter, cmdLoopHeader } from "./cmd-control.ts";
import { cmdFunctionDeclaration } from "./cmd-function.ts";
import { foreignDeclaration } from "./declaration.ts";
import {
    cmdAssignmentValue,
    cmdValue,
    commandArgumentsText,
    type ForeignTarget,
    fishValue,
    foreignSourceCommand,
    powerShellType,
    powerShellValue,
    unquote,
} from "./syntax.ts";

function commandStatement(
    invocation: CommandInvocation,
): Extract<Statement, { kind: "CommandStatement" }> | undefined {
    const [name, ...argumentsList] = invocation.words;

    if (name === undefined) {
        return undefined;
    }

    const argumentsWithKinds: CommandArgument[] = argumentsList.map((word) => {
        return {
            kind: "CommandArgument",
            value: word.text,
            text: word.text,
            range: word.range,
        };
    });

    return {
        kind: "CommandStatement",
        name: name.text,
        arguments: argumentsWithKinds,
        text: invocation.text,
        range: invocation.range,
    };
}

function assignmentParts(
    value: string,
): { name: string; value: string } | undefined {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(value);

    return match === null
        ? undefined
        : { name: match[1] ?? "", value: match[2] ?? "" };
}

function positionalCommand(
    statement: Extract<Statement, { kind: "CommandStatement" }>,
    start: number,
): Extract<Statement, { kind: "CommandStatement" }> | undefined {
    const name = statement.arguments[start];

    if (name === undefined) {
        return undefined;
    }

    return {
        kind: "CommandStatement",
        name: name.value,
        arguments: statement.arguments.slice(start + 1),
        text: statement.text,
        range: statement.range,
    };
}

function powerShellExpression(value: string): string {
    if (
        /^-?[0-9]+$/.test(value) ||
        value === "$true" ||
        value === "$false" ||
        value.startsWith("$") ||
        value.startsWith('"') ||
        value.startsWith("'")
    ) {
        return powerShellValue(value);
    }

    return `'${value.replace(/'/g, "''")}'`;
}

function powerShellTest(argumentsList: readonly CommandArgument[]): string {
    const values = argumentsList.map((argument) => {
        return argument.value;
    });

    if (values[0] === "!" && values.length > 1) {
        const nested = values.slice(1).map((value, index) => {
            return {
                kind: "CommandArgument" as const,
                value,
                text: value,
                range: argumentsList[index + 1]?.range ?? { start: 0, end: 0 },
            };
        });

        return `-not (${powerShellTest(nested)})`;
    }

    const unary = values[0];

    const unaryValue = values[1];

    if (unaryValue !== undefined) {
        const expression = powerShellExpression(unaryValue);

        if (unary === "-z") {
            return `[string]::IsNullOrEmpty(${expression})`;
        }

        if (unary === "-n") {
            return `-not [string]::IsNullOrEmpty(${expression})`;
        }

        if (unary === "-e") {
            return `Test-Path -LiteralPath ${expression}`;
        }

        if (unary === "-f") {
            return `Test-Path -LiteralPath ${expression} -PathType Leaf`;
        }

        if (unary === "-d") {
            return `Test-Path -LiteralPath ${expression} -PathType Container`;
        }
    }

    const left = values[0];

    const operator = values[1];

    const right = values[2];

    if (left !== undefined && operator !== undefined && right !== undefined) {
        const operators: Readonly<Record<string, string>> = {
            "=": "-eq",
            "==": "-eq",
            "!=": "-ne",
            "-eq": "-eq",
            "-ne": "-ne",
            "-lt": "-lt",
            "-le": "-le",
            "-gt": "-gt",
            "-ge": "-ge",
        };

        const translated = operators[operator];

        if (translated !== undefined) {
            return `${powerShellExpression(left)} ${translated} ${powerShellExpression(right)}`;
        }
    }

    return values[0] === undefined
        ? "$false"
        : `-not [string]::IsNullOrEmpty(${powerShellExpression(values[0])})`;
}

function powerShellCondition(
    statement: Extract<Statement, { kind: "CommandStatement" }>,
    start: number,
): string {
    const command = positionalCommand(statement, start);

    if (command === undefined) {
        return "$false";
    }

    if (command.name === "true" || command.name === ":") {
        return "$true";
    }

    if (command.name === "false") {
        return "$false";
    }

    if (command.name === "test" || command.name === "[") {
        const argumentsList = command.arguments.filter((argument) => {
            return argument.value !== "]";
        });

        return powerShellTest(argumentsList);
    }

    const invocation = simplePowerShellCommand(command);

    return `(& { ${invocation}; return $LASTEXITCODE }) -eq 0`;
}

function powerShellControl(
    statement: Extract<Statement, { kind: "CommandStatement" }>,
): string | undefined {
    if (statement.name === "if") {
        return `if (${powerShellCondition(statement, 0)}) {`;
    }

    if (statement.name === "elif") {
        return `} elseif (${powerShellCondition(statement, 0)}) {`;
    }

    if (statement.name === "else") {
        return "} else {";
    }

    if (statement.name === "fi" || statement.name === "done") {
        return "}";
    }

    if (statement.name === "while" || statement.name === "until") {
        const condition = powerShellCondition(statement, 0);

        return `while (${statement.name === "until" ? `-not (${condition})` : condition}) {`;
    }

    if (statement.name === "for" && statement.arguments[1]?.value === "in") {
        const variable = statement.arguments[0]?.value ?? "item";

        const values = statement.arguments
            .slice(2)
            .map((argument) => {
                return powerShellExpression(argument.value);
            })
            .join(", ");

        return `foreach ($${variable} in @(${values})) {`;
    }

    return undefined;
}

function fishControl(
    statement: Extract<Statement, { kind: "CommandStatement" }>,
): string | undefined {
    if (statement.name === "if" || statement.name === "elif") {
        const condition = positionalCommand(statement, 0);

        return `${statement.name} ${condition === undefined ? "false" : simpleFishCommand(condition)}`;
    }

    if (statement.name === "else") {
        return "else";
    }

    if (statement.name === "fi" || statement.name === "done") {
        return "end";
    }

    if (statement.name === "while" || statement.name === "until") {
        const condition = positionalCommand(statement, 0);

        const command =
            condition === undefined ? "false" : simpleFishCommand(condition);

        return statement.name === "until"
            ? `while not ${command}`
            : `while ${command}`;
    }

    if (statement.name === "for" && statement.arguments[1]?.value === "in") {
        const variable = statement.arguments[0]?.value ?? "item";

        const values = commandArgumentsText(
            statement.arguments.slice(2),
            fishValue,
        );

        return `for ${variable} in ${values}`.trimEnd();
    }

    return undefined;
}

function powerShellPrintf(
    statement: Extract<Statement, { kind: "CommandStatement" }>,
): string {
    const formatArgument = statement.arguments[0];

    if (formatArgument === undefined) {
        return "";
    }

    let format = unquote(formatArgument.value)
        .replace(/`/g, "``")
        .replace(/\r/g, "`r")
        .replace(/\\n/g, "`n");

    let placeholder = 0;

    format = format.replace(/%[sd]/g, () => {
        const result = `{${placeholder}}`;

        placeholder += 1;

        return result;
    });

    const values = statement.arguments
        .slice(1)
        .map((argument) => {
            return powerShellValue(argument.value);
        })
        .join(", ");

    return `[Console]::Write("${format}"${values === "" ? "" : `, ${values}`})`;
}

function simplePowerShellCommand(
    statement: Extract<Statement, { kind: "CommandStatement" }>,
): string {
    const assignment = assignmentParts(statement.name);

    if (assignment !== undefined && statement.arguments.length === 0) {
        return `$${assignment.name} = ${powerShellValue(assignment.value)}`;
    }

    if (statement.name === "printf") {
        return powerShellPrintf(statement);
    }

    if (statement.name === "echo") {
        return `Write-Output ${commandArgumentsText(statement.arguments, powerShellValue)}`.trimEnd();
    }

    if (["local", "declare", "export", "readonly"].includes(statement.name)) {
        const assignmentArgument = statement.arguments.find((argument) => {
            return assignmentParts(argument.value) !== undefined;
        });

        const parsed =
            assignmentArgument === undefined
                ? undefined
                : assignmentParts(assignmentArgument.value);

        if (parsed !== undefined) {
            return `$${parsed.name} = ${powerShellValue(parsed.value)}`;
        }
    }

    if (statement.name === "return") {
        const status = statement.arguments[0]?.value;

        return status === undefined
            ? "return"
            : `$global:LASTEXITCODE = ${powerShellValue(status)}; return`;
    }

    if (statement.name === "source" || statement.name === ".") {
        const source = statement.arguments[0]?.value ?? "";

        return foreignSourceCommand(source, "powershell");
    }

    if (statement.name === "true" || statement.name === ":") {
        return "$true | Out-Null";
    }

    if (statement.name === "false") {
        return "$false | Out-Null; $global:LASTEXITCODE = 1";
    }

    return `${statement.name} ${commandArgumentsText(statement.arguments, powerShellValue)}`.trimEnd();
}

function powerShellCommand(
    statement: Extract<Statement, { kind: "CommandStatement" }>,
): string {
    const control = powerShellControl(statement);

    if (control !== undefined) {
        return control;
    }

    const syntax = statement.syntax;

    if (syntax === undefined) {
        return simplePowerShellCommand(statement);
    }

    const pipelines = syntax.pipelines.map((pipeline) => {
        const commands = pipeline.commands.map((invocation) => {
            const command = commandStatement(invocation);

            return command === undefined
                ? ""
                : simplePowerShellCommand(command);
        });

        const value = commands
            .map((command, index) => {
                const operator =
                    index === 0
                        ? ""
                        : ` ${pipeline.operators[index - 1] ?? "|"} `;

                return `${operator}${command}`;
            })
            .join("");

        return pipeline.negated ? `! (${value})` : value;
    });

    return pipelines
        .map((pipeline, index) => {
            const operator =
                index === 0 ? "" : ` ${syntax.operators[index - 1] ?? ";"} `;

            return `${operator}${pipeline}`;
        })
        .join("");
}

function simpleFishCommand(
    statement: Extract<Statement, { kind: "CommandStatement" }>,
): string {
    const assignment = assignmentParts(statement.name);

    if (assignment !== undefined && statement.arguments.length === 0) {
        return `set ${assignment.name} ${fishValue(assignment.value)}`;
    }

    if (["local", "declare"].includes(statement.name)) {
        const argument = statement.arguments.find((candidate) => {
            return assignmentParts(candidate.value) !== undefined;
        });

        const parsed =
            argument === undefined
                ? undefined
                : assignmentParts(argument.value);

        if (parsed !== undefined) {
            return `set -l ${parsed.name} ${fishValue(parsed.value)}`;
        }
    }

    if (statement.name === "export") {
        const argument = statement.arguments.find((candidate) => {
            return assignmentParts(candidate.value) !== undefined;
        });

        const parsed =
            argument === undefined
                ? undefined
                : assignmentParts(argument.value);

        if (parsed !== undefined) {
            return `set -gx ${parsed.name} ${fishValue(parsed.value)}`;
        }
    }

    if (statement.name === "source" || statement.name === ".") {
        const source = statement.arguments[0]?.value ?? "";

        return foreignSourceCommand(source, "fish");
    }

    return `${statement.name} ${commandArgumentsText(statement.arguments, fishValue)}`.trimEnd();
}

function fishCommand(
    statement: Extract<Statement, { kind: "CommandStatement" }>,
): string {
    const control = fishControl(statement);

    if (control !== undefined) {
        return control;
    }

    const syntax = statement.syntax;

    if (syntax === undefined) {
        return simpleFishCommand(statement);
    }

    const pipelines = syntax.pipelines.map((pipeline) => {
        const commands = pipeline.commands.map((invocation) => {
            const command = commandStatement(invocation);

            return command === undefined ? "" : simpleFishCommand(command);
        });

        const value = commands
            .map((command, index) => {
                const operator =
                    index === 0
                        ? ""
                        : ` ${pipeline.operators[index - 1] ?? "|"} `;

                return `${operator}${command}`;
            })
            .join("");

        return pipeline.negated ? `not ${value}` : value;
    });

    return pipelines
        .map((pipeline, index) => {
            const sourceOperator = syntax.operators[index - 1];

            const operator =
                sourceOperator === "&&"
                    ? " and "
                    : sourceOperator === "||"
                      ? " or "
                      : sourceOperator === "&"
                        ? " & "
                        : index === 0
                          ? ""
                          : "; ";

            return `${operator}${pipeline}`;
        })
        .join("");
}

function simpleCmdCommand(
    statement: Extract<Statement, { kind: "CommandStatement" }>,
    functions: ReadonlySet<string>,
): string {
    const assignment = assignmentParts(statement.name);

    if (assignment !== undefined && statement.arguments.length === 0) {
        return `set "${assignment.name}=${cmdAssignmentValue(assignment.value)}"`;
    }

    if (["local", "declare", "export", "readonly"].includes(statement.name)) {
        const argument = statement.arguments.find((candidate) => {
            return assignmentParts(candidate.value) !== undefined;
        });

        const parsed =
            argument === undefined
                ? undefined
                : assignmentParts(argument.value);

        if (parsed !== undefined) {
            return `set "${parsed.name}=${cmdAssignmentValue(parsed.value)}"`;
        }
    }

    if (statement.name === "return") {
        return `exit /b ${cmdValue(statement.arguments[0]?.value ?? "0")}`;
    }

    if (statement.name === "source" || statement.name === ".") {
        return foreignSourceCommand(statement.arguments[0]?.value ?? "", "cmd");
    }

    if (functions.has(statement.name)) {
        const argumentsText = commandArgumentsText(
            statement.arguments,
            cmdValue,
        );

        return `call :${statement.name}${argumentsText === "" ? "" : ` ${argumentsText}`}`;
    }

    return `${statement.name} ${commandArgumentsText(statement.arguments, cmdValue)}`.trimEnd();
}

function cmdCommand(
    statement: Extract<Statement, { kind: "CommandStatement" }>,
    functions: ReadonlySet<string>,
): string {
    const control = cmdControl(statement);

    if (control !== undefined) {
        return control;
    }

    const syntax = statement.syntax;

    if (syntax === undefined) {
        return simpleCmdCommand(statement, functions);
    }

    const pipelines = syntax.pipelines.map((pipeline) => {
        const commands = pipeline.commands.map((invocation) => {
            const command = commandStatement(invocation);

            return command === undefined
                ? ""
                : simpleCmdCommand(command, functions);
        });

        return commands
            .map((command, index) => {
                const operator =
                    index === 0
                        ? ""
                        : ` ${pipeline.operators[index - 1] ?? "|"} `;

                return `${operator}${command}`;
            })
            .join("");
    });

    return pipelines
        .map((pipeline, index) => {
            const operator =
                index === 0 ? "" : ` ${syntax.operators[index - 1] ?? "&"} `;

            return `${operator}${pipeline}`;
        })
        .join("");
}

function functionDeclaration(
    statement: FunctionDeclaration,
    target: ForeignTarget,
    functions: ReadonlySet<string>,
): string {
    if (target === "powershell") {
        const parameters = statement.parameters.map((parameter) => {
            const defaultValue =
                parameter.defaultValue === undefined
                    ? ""
                    : ` = ${powerShellValue(parameter.defaultValue)}`;

            const rest = parameter.rest
                ? "[Parameter(ValueFromRemainingArguments)] "
                : "";

            return `        ${rest}${powerShellType(parameter.type)}$${parameter.name}${defaultValue}`;
        });

        const parameterBlock =
            parameters.length === 0
                ? ""
                : `    param(\n${parameters.join(",\n")}\n    )\n`;

        const body = printForeignBody(statement.body, target, "    ");

        return `function ${statement.name} {\n${parameterBlock}${body}}`;
    }

    if (target === "fish") {
        const parameters = statement.parameters
            .map((parameter) => {
                return `    set -l ${parameter.name} $argv[${statement.parameters.indexOf(parameter) + 1}]`;
            })
            .join("\n");

        const body = printForeignBody(statement.body, target, "    ");

        return `function ${statement.name}\n${parameters}${parameters === "" ? "" : "\n"}${body}end`;
    }

    const body = printForeignBody(statement.body, target, "", functions);

    return cmdFunctionDeclaration(statement, body);
}

/** Renders statements recursively while retaining target-specific block state. */
export function printForeignBody(
    values: readonly Statement[],
    target: ForeignTarget,
    indent = "",
    inheritedFunctions: ReadonlySet<string> = new Set(),
): string {
    let result = "";

    let depth = 0;

    let loopLabel = 0;

    const cmdLoops: Array<{ kind: "for" | "loop"; label?: number }> = [];

    const functions = new Set(inheritedFunctions);

    for (const value of values) {
        if (value.kind === "FunctionDeclaration") {
            functions.add(value.name);
        }
    }

    for (const statement of values) {
        let emitted: string;

        const controlName =
            statement.kind === "CommandStatement" ? statement.name : undefined;

        const cmdLoopEnd =
            target === "cmd" && controlName === "done"
                ? cmdLoops.pop()
                : undefined;

        const closes =
            controlName === "fi" ||
            controlName === "done" ||
            controlName === "elif" ||
            controlName === "else";

        if (closes) {
            depth = Math.max(0, depth - 1);
        }

        if (statement.kind === "TypedVariableDeclaration") {
            emitted = foreignDeclaration(statement, target);
        } else if (statement.kind === "FunctionDeclaration") {
            emitted = functionDeclaration(statement, target, functions);
        } else if (statement.kind === "CommandStatement") {
            if (
                target === "cmd" &&
                (controlName === "while" || controlName === "until")
            ) {
                loopLabel += 1;

                cmdLoops.push({ kind: "loop", label: loopLabel });

                emitted = cmdLoopHeader(statement, loopLabel);
            } else if (target === "cmd" && controlName === "for") {
                cmdLoops.push({ kind: "for" });

                emitted = cmdCommand(statement, functions);
            } else if (target === "cmd" && cmdLoopEnd !== undefined) {
                emitted =
                    cmdLoopEnd.kind === "loop" && cmdLoopEnd.label !== undefined
                        ? cmdLoopFooter(cmdLoopEnd.label)
                        : ")";
            } else {
                emitted =
                    target === "powershell"
                        ? powerShellCommand(statement)
                        : target === "fish"
                          ? fishCommand(statement)
                          : cmdCommand(statement, functions);
            }
        } else if (statement.kind === "TypeImportDeclaration") {
            emitted = "";
        } else if (statement.kind === "EnvironmentDeclaration") {
            emitted = "";
        } else if (statement.kind === "ExternalCommandDeclaration") {
            emitted = "";
        } else if (statement.kind === "SourceImportDeclaration") {
            emitted = foreignSourceCommand(statement.specifier, target);
        } else {
            emitted = statement.text.trimStart().startsWith("#!")
                ? ""
                : statement.text.trim();
        }

        if (emitted === "") {
            continue;
        }

        const nestedIndent = `${indent}${"    ".repeat(depth)}`;

        result += `${emitted
            .split("\n")
            .map((line) => {
                return line === "" ? line : `${nestedIndent}${line}`;
            })
            .join("\n")}\n`;

        const opens =
            controlName === "if" ||
            controlName === "while" ||
            controlName === "until" ||
            controlName === "for" ||
            controlName === "elif" ||
            controlName === "else";

        if (opens) {
            depth += 1;
        }
    }

    return result;
}
