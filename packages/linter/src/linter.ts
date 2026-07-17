import {
    type BindingResult,
    bindSourceFile,
    type SourceFile,
    type Statement,
} from "@wiz/compiler";
import type { LinterOptions } from "./config.ts";
import { getRule, registeredCustomRules, rules } from "./registry.ts";
import type { LintDiagnostic, LintFix, RuleSeverity } from "./rule.ts";

const shellProvided = new Set([
    "HOME",
    "PATH",
    "PWD",
    "OLDPWD",
    "SHELL",
    "USER",
    "UID",
    "EUID",
    "IFS",
    "RANDOM",
    "LINENO",
    "BASH_SOURCE",
]);

function severity(name: string, options: LinterOptions): RuleSeverity {
    const configured = options.rules?.[name];

    if (configured !== undefined) {
        return configured;
    }

    const definition = getRule(name);

    if (
        options.recommended === false &&
        definition?.defaultSeverity !== "error"
    ) {
        return "off";
    }

    return definition?.defaultSeverity ?? "off";
}

function report(
    result: LintDiagnostic[],
    file: SourceFile,
    options: LinterOptions,
    ruleName: string,
    message: string,
    start: number,
    end: number,
    fix?: LintFix,
): void {
    const definition = getRule(ruleName);

    const configured = severity(ruleName, options);

    if (definition === undefined || configured === "off") {
        return;
    }

    result.push({
        rule: ruleName,
        category: definition.category,
        severity: configured,
        message,
        fileName: file.fileName,
        range: { start, end },
        ...(fix === undefined ? {} : { fix }),
    });
}

function expansions(
    text: string,
    base: number,
): Array<{
    name: string;
    start: number;
    end: number;
    quoted: boolean;
    array: boolean;
}> {
    const result: Array<{
        name: string;
        start: number;
        end: number;
        quoted: boolean;
        array: boolean;
    }> = [];

    let quote: string | undefined;

    // Quote state matters here because the same expansion is safe in double quotes and unsafe bare.
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];

        if (character === "\\") {
            index += 1;

            continue;
        }

        if (character === "'") {
            quote =
                quote === "'" ? undefined : quote === undefined ? "'" : quote;

            continue;
        }

        if (character === '"' && quote !== "'") {
            quote = quote === '"' ? undefined : '"';

            continue;
        }

        if (character !== "$" || quote === "'") {
            continue;
        }

        const brace = text[index + 1] === "{";

        let cursor = index + (brace ? 2 : 1);

        const startName = cursor;

        while (
            cursor < text.length &&
            /[A-Za-z0-9_]/.test(text[cursor] ?? "")
        ) {
            cursor += 1;
        }

        if (cursor === startName) {
            continue;
        }

        const name = text.slice(startName, cursor);

        const close = brace ? text.indexOf("}", cursor) : cursor;

        const end = brace && close >= 0 ? close + 1 : cursor;

        const body = text.slice(index, end);

        result.push({
            name,
            start: base + index,
            end: base + end,
            quoted: quote === '"',
            array: body.includes("[@]") || body.includes("[*]"),
        });

        index = end - 1;
    }

    return result;
}

function checkCommand(
    statement: Extract<Statement, { kind: "CommandStatement" }>,
    file: SourceFile,
    binding: BindingResult,
    options: LinterOptions,
    result: LintDiagnostic[],
    functionDeclaration?: Extract<Statement, { kind: "FunctionDeclaration" }>,
    lastInScope = false,
): void {
    const scope = binding.nodeScopes.get(statement) ?? binding.globalScope;

    for (const expansion of expansions(statement.text, statement.range.start)) {
        if (
            functionDeclaration?.typed === true &&
            /^\d+$/.test(expansion.name) &&
            Number(expansion.name) > functionDeclaration.parameters.length
        ) {
            report(
                result,
                file,
                options,
                "correctness/no-invalid-positional-parameter",
                `Positional parameter $${expansion.name} is outside the typed signature`,
                expansion.start,
                expansion.end,
            );
        }

        if (
            !/^\d+$/.test(expansion.name) &&
            !shellProvided.has(expansion.name) &&
            scope.resolve(expansion.name) === undefined
        ) {
            report(
                result,
                file,
                options,
                "correctness/no-undefined-variable",
                `Variable is not defined: ${expansion.name}`,
                expansion.start,
                expansion.end,
            );
        }

        if (!expansion.quoted && !expansion.array) {
            const original = file.text.slice(expansion.start, expansion.end);

            report(
                result,
                file,
                options,
                "safety/no-unquoted-expansion",
                `Quote $${expansion.name} to prevent word splitting`,
                expansion.start,
                expansion.end,
                {
                    range: { start: expansion.start, end: expansion.end },
                    text: `"${original}"`,
                    safe: true,
                },
            );

            report(
                result,
                file,
                options,
                "safety/no-word-splitting-assumption",
                `Unquoted $${expansion.name} relies on word splitting`,
                expansion.start,
                expansion.end,
            );
        }

        if (!expansion.quoted && expansion.array) {
            report(
                result,
                file,
                options,
                "safety/no-unquoted-array-expansion",
                `Quote the ${expansion.name} array expansion`,
                expansion.start,
                expansion.end,
            );
        }
    }

    if (statement.name === "eval") {
        report(
            result,
            file,
            options,
            "safety/no-eval",
            "Avoid eval; pass arguments as an array or invoke the command directly",
            statement.range.start,
            statement.range.start + 4,
        );
    }

    if (
        (statement.name === "source" || statement.name === ".") &&
        statement.arguments[0]?.value.includes("$")
    ) {
        report(
            result,
            file,
            options,
            "safety/no-dynamic-source",
            "Dynamic source paths cannot be resolved or checked statically",
            statement.arguments[0].range.start,
            statement.arguments[0].range.end,
        );
    }

    if (
        statement.name === "rm" &&
        statement.arguments.some((argument) => {
            return argument.value.includes("-r");
        }) &&
        statement.arguments.some((argument) => {
            return ["/", '"/"', "'$HOME'", '"$HOME"'].includes(argument.value);
        })
    ) {
        report(
            result,
            file,
            options,
            "safety/no-unsafe-rm",
            "Recursive removal targets a root-like path",
            statement.range.start,
            statement.range.end,
        );
    }

    if (statement.name === "return") {
        const value = statement.arguments[0]?.value;

        if (value !== undefined && /^\d+$/.test(value) && Number(value) > 255) {
            report(
                result,
                file,
                options,
                "correctness/no-invalid-return-status",
                "Shell return status must be between 0 and 255",
                statement.arguments[0]?.range.start ?? statement.range.start,
                statement.arguments[0]?.range.end ?? statement.range.end,
            );
        }
    }

    if (statement.name === "[") {
        const replacement = statement.text
            .replace(/^(\s*)\[/, "$1[[")
            .replace(/\](\s*(?:\r?\n)?)$/, "]]$1");

        report(
            result,
            file,
            options,
            "style/prefer-double-brackets",
            "Use [[ ... ]] for Bash conditions",
            statement.range.start,
            statement.range.end,
            {
                range: statement.range,
                text: replacement,
                safe: false,
            },
        );
    }

    if (
        (statement.name === "[" || statement.name === "[[") &&
        statement.arguments.filter((argument) => {
            return argument.value !== "]" && argument.value !== "]]";
        }).length === 0
    ) {
        report(
            result,
            file,
            options,
            "suspicious/no-empty-condition",
            "Condition is empty and cannot express an intentional test",
            statement.range.start,
            statement.range.end,
        );
    }

    if (statement.name === "[[") {
        const comparison = statement.arguments;

        const operatorIndex = comparison.findIndex((argument) => {
            return argument.value === "==" || argument.value === "=";
        });

        const left = comparison[operatorIndex - 1];

        const right = comparison[operatorIndex + 1];

        const leftExpansion =
            left === undefined
                ? undefined
                : expansions(left.value, left.range.start)[0];

        const leftSymbol =
            leftExpansion === undefined
                ? undefined
                : scope.resolve(leftExpansion.name);

        const rightType =
            right === undefined
                ? undefined
                : /^['"]?-?[0-9]+['"]?$/.test(right.value)
                  ? "int"
                  : /^(?:['"])?(?:true|false)(?:['"])?$/.test(right.value)
                    ? "bool"
                    : "string";

        if (
            leftSymbol !== undefined &&
            rightType !== undefined &&
            !["any", "unknown", "string", rightType].includes(
                leftSymbol.type.name,
            )
        ) {
            report(
                result,
                file,
                options,
                "correctness/no-impossible-type-check",
                `Comparison cannot succeed: ${leftSymbol.name} is ${leftSymbol.type.name}, not ${rightType}`,
                statement.range.start,
                statement.range.end,
            );
        }
    }

    if (statement.name.startsWith("$(")) {
        report(
            result,
            file,
            options,
            "suspicious/no-useless-command-substitution",
            "Command substitution output is discarded",
            statement.range.start,
            statement.range.end,
        );
    }

    const callable = scope.resolve(statement.name);

    if (
        !lastInScope &&
        callable?.type.name === "status" &&
        callable.declaration.kind === "FunctionDeclaration" &&
        !statement.text.includes("&&") &&
        !statement.text.includes("||")
    ) {
        report(
            result,
            file,
            options,
            "suspicious/no-ignored-status",
            `Status returned by ${statement.name} is ignored`,
            statement.range.start,
            statement.range.end,
        );
    }

    const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(statement.name);

    if (assignment !== null && statement.arguments.length === 0) {
        const name = assignment[1] ?? "";

        const assignedSymbol = scope.resolve(name);

        if (assignedSymbol?.type.name === "any") {
            report(
                result,
                file,
                options,
                "suspicious/no-implicit-any",
                `Untyped variable ${name} is inferred with type any`,
                statement.range.start,
                statement.range.start + name.length,
            );

            if (functionDeclaration !== undefined) {
                const indentation = Math.max(0, statement.text.search(/\S/));

                const insertion = statement.range.start + indentation;

                report(
                    result,
                    file,
                    options,
                    "style/prefer-local",
                    `Declare ${name} as local to avoid leaking function state`,
                    statement.range.start,
                    statement.range.end,
                    {
                        range: {
                            start: insertion,
                            end: insertion,
                        },
                        text: "local ",
                        safe: false,
                    },
                );
            }
        }
    }

    if (
        statement.name === "declare" &&
        statement.arguments.length > 0 &&
        statement.arguments.every((argument) => {
            return !argument.value.startsWith("-");
        })
    ) {
        report(
            result,
            file,
            options,
            "style/no-redundant-declare",
            "declare has no attributes or Wiz type annotation",
            statement.range.start,
            statement.range.start + "declare".length,
        );
    }
}

function checkStatements(
    statements: readonly Statement[],
    file: SourceFile,
    binding: BindingResult,
    options: LinterOptions,
    result: LintDiagnostic[],
    functionDeclaration?: Extract<Statement, { kind: "FunctionDeclaration" }>,
): void {
    for (const [index, statement] of statements.entries()) {
        if (statement.kind === "CommandStatement") {
            checkCommand(
                statement,
                file,
                binding,
                options,
                result,
                functionDeclaration,
                index === statements.length - 1,
            );
        } else if (statement.kind === "FunctionDeclaration") {
            const parameters = new Set(
                statement.parameters.map((parameter) => {
                    return parameter.name;
                }),
            );

            for (const bodyStatement of statement.body) {
                if (
                    bodyStatement.kind === "TypedVariableDeclaration" &&
                    bodyStatement.name !== undefined &&
                    parameters.has(bodyStatement.name)
                ) {
                    report(
                        result,
                        file,
                        options,
                        "suspicious/no-shadowed-parameter",
                        `Local ${bodyStatement.name} shadows a typed parameter`,
                        bodyStatement.range.start,
                        bodyStatement.range.end,
                    );
                }

                if (
                    bodyStatement.kind === "TypedVariableDeclaration" &&
                    bodyStatement.positionalParameter !== undefined
                ) {
                    report(
                        result,
                        file,
                        options,
                        "style/prefer-typed-parameters",
                        "Prefer a typed function signature over positional assertions",
                        bodyStatement.range.start,
                        bodyStatement.range.end,
                    );
                }
            }

            checkStatements(
                statement.body,
                file,
                binding,
                options,
                result,
                statement,
            );
        }
    }
}

function suppressionRules(value: string): readonly string[] {
    return value
        .split(",")
        .map((rule) => {
            return rule.trim();
        })
        .filter((rule) => {
            return rule.length > 0;
        });
}

function suppressedByComment(
    file: SourceFile,
    diagnostic: LintDiagnostic,
): boolean {
    const before = file.text.slice(0, diagnostic.range.start);

    const lines = before.split(/\r?\n/);

    const disabled = new Set<string>();

    for (const line of lines) {
        const directive = /^\s*#\s*wiz-(disable|enable)\s+(.+?)\s*$/.exec(line);

        if (directive === null) {
            continue;
        }

        for (const rule of suppressionRules(directive[2] ?? "")) {
            if (directive[1] === "disable") {
                disabled.add(rule);
            } else {
                disabled.delete(rule);
            }
        }
    }

    if (disabled.has(diagnostic.rule) || disabled.has("all")) {
        return true;
    }

    const previousLine = lines.at(-2) ?? "";

    const ignore = /^\s*#\s*wiz-ignore\s+(.+?)\s*$/.exec(previousLine);

    if (ignore === null) {
        return false;
    }

    const ignored = suppressionRules(ignore[1] ?? "");

    return ignored.includes("all") || ignored.includes(diagnostic.rule);
}

function applySuppressions(
    file: SourceFile,
    diagnostics: readonly LintDiagnostic[],
    options: LinterOptions,
): readonly LintDiagnostic[] {
    return diagnostics.filter((diagnostic) => {
        if (suppressedByComment(file, diagnostic)) {
            return false;
        }

        return !options.baseline?.some((entry) => {
            return (
                entry.fileName === diagnostic.fileName &&
                entry.rule === diagnostic.rule &&
                (entry.start === undefined ||
                    entry.start === diagnostic.range.start)
            );
        });
    });
}

/** Runs configured semantic lint rules against a compiler source file. */
export function lintSourceFile(
    file: SourceFile,
    options: LinterOptions = {},
    binding = bindSourceFile(file),
): readonly LintDiagnostic[] {
    const result: LintDiagnostic[] = [];

    checkStatements(file.statements, file, binding, options, result);

    const reportPluginDiagnostic = report;

    for (const rule of registeredCustomRules()) {
        if (severity(rule.definition.name, options) === "off") {
            continue;
        }

        rule.run({
            file,
            binding,
            report(message, range, fix): void {
                reportPluginDiagnostic(
                    result,
                    file,
                    options,
                    rule.definition.name,
                    message,
                    range.start,
                    range.end,
                    fix,
                );
            },
        });
    }

    return applySuppressions(file, result, options).toSorted((left, right) => {
        return (
            left.range.start - right.range.start ||
            left.rule.localeCompare(right.rule)
        );
    });
}

/** Applies non-overlapping fixes from the end so earlier offsets remain stable. */
export function applyLintFixes(
    source: string,
    diagnostics: readonly LintDiagnostic[],
    includeUnsafe = false,
): string {
    const fixes = diagnostics
        .map((diagnostic) => {
            return diagnostic.fix;
        })
        .filter((fix): fix is LintFix => {
            return fix !== undefined && (fix.safe || includeUnsafe);
        })
        .toSorted((left, right) => {
            return right.range.start - left.range.start;
        });

    let result = source;

    let nextBoundary = source.length;

    for (const fix of fixes) {
        if (
            fix.range.start < 0 ||
            fix.range.end < fix.range.start ||
            fix.range.end > nextBoundary
        ) {
            continue;
        }

        result =
            result.slice(0, fix.range.start) +
            fix.text +
            result.slice(fix.range.end);

        nextBoundary = fix.range.start;
    }

    return result;
}

export { rules };
