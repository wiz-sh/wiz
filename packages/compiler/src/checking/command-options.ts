import type {
    CommandArgument,
    CommandOption,
    SourceFile,
    Statement,
} from "../ast/source-file.ts";
import type { BindingResult } from "../binding/binder.ts";
import type { Scope } from "../binding/scope.ts";
import { DiagnosticCodes } from "../diagnostics/codes.ts";
import type { Diagnostic } from "../diagnostics/diagnostic.ts";
import { isAssignable } from "../types/assignability.ts";
import { inferArgument } from "./inference.ts";

export interface ParsedCommandOptions {
    arguments: readonly CommandArgument[];
    seen: ReadonlyMap<string, CommandOption>;
}

function optionByName(
    options: readonly CommandOption[],
    name: string,
): CommandOption | undefined {
    return options.find((option) => {
        return option.names.includes(name);
    });
}

/** Separates native command options from positionals and validates their contracts. */
export function checkCommandOptions(
    statement: Extract<Statement, { kind: "CommandStatement" }>,
    options: readonly CommandOption[],
    file: SourceFile,
    binding: BindingResult,
    diagnostics: Diagnostic[],
    scopeOverride?: Scope,
): ParsedCommandOptions {
    if (options.length === 0) {
        return { arguments: statement.arguments, seen: new Map() };
    }

    const positional: CommandArgument[] = [];

    const seen = new Map<string, CommandOption>();

    let optionMode = true;

    for (let index = 0; index < statement.arguments.length; index += 1) {
        const argument = statement.arguments[index];

        if (argument === undefined) {
            continue;
        }

        if (argument.value === "--") {
            optionMode = false;

            continue;
        }

        if (
            !optionMode ||
            !argument.value.startsWith("-") ||
            /^-\d+$/.test(argument.value)
        ) {
            positional.push(argument);

            continue;
        }

        const equals = argument.value.indexOf("=");

        const name =
            equals < 0 ? argument.value : argument.value.slice(0, equals);

        const option = optionByName(options, name);

        if (option === undefined) {
            diagnostics.push({
                code: DiagnosticCodes.unknownCommandOption,
                message: `Unknown option ${name} for ${statement.name}`,
                severity: "error",
                phase: "type",
                fileName: file.fileName,
                range: argument.range,
            });

            continue;
        }

        const canonical = option.names.at(-1) ?? name;

        if (!option.repeatable && seen.has(canonical)) {
            diagnostics.push({
                code: DiagnosticCodes.commandOptionConflict,
                message: `Option ${name} cannot be repeated`,
                severity: "error",
                phase: "type",
                fileName: file.fileName,
                range: argument.range,
            });
        }

        seen.set(canonical, option);

        if (option.valueType === undefined) {
            continue;
        }

        const inlineValue =
            equals < 0 ? undefined : argument.value.slice(equals + 1);

        const valueArgument =
            inlineValue === undefined
                ? statement.arguments[index + 1]
                : argument;

        const value = inlineValue ?? valueArgument?.value;

        if (value === undefined || value === "") {
            diagnostics.push({
                code: DiagnosticCodes.missingCommandOptionValue,
                message: `Option ${name} requires ${option.valueName ?? "a value"}`,
                severity: "error",
                phase: "type",
                fileName: file.fileName,
                range: argument.range,
            });

            continue;
        }

        if (inlineValue === undefined) {
            index += 1;
        }

        const actual = inferArgument(
            value,
            scopeOverride ??
                binding.nodeScopes.get(statement) ??
                binding.globalScope,
            option.valueType.kind === "literal" ||
                option.valueType.kind === "union",
        );

        if (!isAssignable(actual, option.valueType)) {
            diagnostics.push({
                code: DiagnosticCodes.typeMismatch,
                message: `Option ${name} expects ${option.valueType.name}, but received ${actual.name}`,
                severity: "error",
                phase: "type",
                fileName: file.fileName,
                range: valueArgument?.range ?? argument.range,
            });
        }
    }

    validateRelationships(statement, options, seen, file, diagnostics);

    return { arguments: positional, seen };
}

function validateRelationships(
    statement: Extract<Statement, { kind: "CommandStatement" }>,
    options: readonly CommandOption[],
    seen: ReadonlyMap<string, CommandOption>,
    file: SourceFile,
    diagnostics: Diagnostic[],
): void {
    for (const option of options) {
        const canonical = option.names.at(-1) ?? "";

        const present = seen.has(canonical);

        if (option.required && !present) {
            diagnostics.push({
                code: DiagnosticCodes.missingRequiredCommandOption,
                message: `Command ${statement.name} requires option ${canonical}`,
                severity: "error",
                phase: "type",
                fileName: file.fileName,
                range: statement.range,
            });
        }

        if (!present) {
            continue;
        }

        for (const conflict of option.conflicts) {
            if (seen.has(conflict)) {
                diagnostics.push({
                    code: DiagnosticCodes.commandOptionConflict,
                    message: `Option ${canonical} conflicts with ${conflict}`,
                    severity: "error",
                    phase: "type",
                    fileName: file.fileName,
                    range: statement.range,
                });
            }
        }

        for (const requirement of option.requires) {
            if (!seen.has(requirement)) {
                diagnostics.push({
                    code: DiagnosticCodes.missingRequiredCommandOption,
                    message: `Option ${canonical} requires ${requirement}`,
                    severity: "error",
                    phase: "type",
                    fileName: file.fileName,
                    range: statement.range,
                });
            }
        }
    }
}
