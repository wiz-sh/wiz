import type { CommandArgument, Statement } from "../../ast/source-file.ts";
import { cmdValue, commandArgumentsText } from "./syntax.ts";

type CommandStatement = Extract<Statement, { kind: "CommandStatement" }>;

function quoted(value: string): string {
    const transformed = cmdValue(value);

    if (transformed.startsWith('"') && transformed.endsWith('"')) {
        return transformed;
    }

    return `"${transformed.replaceAll('"', '\\"')}"`;
}

function testCondition(argumentsList: readonly CommandArgument[]): string {
    const values = argumentsList
        .map((argument) => {
            return argument.value;
        })
        .filter((value) => {
            return value !== "]";
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

        return `not ${testCondition(nested)}`;
    }

    const unary = values[0];

    const unaryValue = values[1];

    if (unaryValue !== undefined) {
        if (["-e", "-f", "-d"].includes(unary ?? "")) {
            return `exist ${quoted(unaryValue)}`;
        }

        if (unary === "-z") {
            return `${quoted(unaryValue)}==""`;
        }

        if (unary === "-n") {
            return `not ${quoted(unaryValue)}==""`;
        }
    }

    const left = values[0];

    const operator = values[1];

    const right = values[2];

    if (left !== undefined && operator !== undefined && right !== undefined) {
        const numeric: Readonly<Record<string, string>> = {
            "-eq": "EQU",
            "-ne": "NEQ",
            "-lt": "LSS",
            "-le": "LEQ",
            "-gt": "GTR",
            "-ge": "GEQ",
        };

        const numericOperator = numeric[operator];

        if (numericOperator !== undefined) {
            return `${cmdValue(left)} ${numericOperator} ${cmdValue(right)}`;
        }

        if (operator === "=" || operator === "==") {
            return `${quoted(left)}==${quoted(right)}`;
        }

        if (operator === "!=") {
            return `not ${quoted(left)}==${quoted(right)}`;
        }
    }

    return values[0] === undefined ? "1==0" : `not ${quoted(values[0])}==""`;
}

export function cmdCondition(statement: CommandStatement): string {
    const name = statement.arguments[0]?.value;

    const argumentsList = statement.arguments.slice(1);

    if (name === "true" || name === ":") {
        return "1==1";
    }

    if (name === "false" || name === undefined) {
        return "1==0";
    }

    if (name === "test" || name === "[") {
        return testCondition(argumentsList);
    }

    // Unknown predicates cannot be evaluated inline, but this remains valid batch syntax.
    return "not errorlevel 1";
}

/** Translates block controls that map directly to batch parentheses. */
export function cmdControl(statement: CommandStatement): string | undefined {
    if (statement.name === "if") {
        return `if ${cmdCondition(statement)} (`;
    }

    if (statement.name === "elif") {
        return `) else if ${cmdCondition(statement)} (`;
    }

    if (statement.name === "else") {
        return ") else (";
    }

    if (statement.name === "fi") {
        return ")";
    }

    if (statement.name === "for" && statement.arguments[1]?.value === "in") {
        const variable = statement.arguments[0]?.value ?? "item";

        const values = commandArgumentsText(
            statement.arguments.slice(2),
            cmdValue,
        );

        return `for %%${variable} in (${values}) do (\n    set "${variable}=%%${variable}"`;
    }

    return undefined;
}

export function cmdLoopHeader(
    statement: CommandStatement,
    label: number,
): string {
    const condition = cmdCondition(statement);

    const guard = statement.name === "until" ? condition : `not ${condition}`;

    return `:__wiz_loop_${label}\nif ${guard} goto :__wiz_loop_end_${label}`;
}

export function cmdLoopFooter(label: number): string {
    return `goto :__wiz_loop_${label}\n:__wiz_loop_end_${label}`;
}
