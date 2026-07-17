import type {
    CommandSignature,
    ExternalCommandDeclaration,
    FunctionDeclaration,
    FunctionParameter,
    SourceFile,
    Statement,
} from "./ast/source-file.ts";
import type { BindingResult } from "./binding/binder.ts";
import type { Scope } from "./binding/scope.ts";
import { SymbolFlags } from "./binding/symbol-flags.ts";
import { commandArguments } from "./checking/command-arguments.ts";
import { checkCommandOptions } from "./checking/command-options.ts";
import {
    checkCollectionInitializer,
    inferArgument,
} from "./checking/inference.ts";
import { checkOpaqueBytesUsage } from "./checking/opaque-bytes.ts";
import { DiagnosticCodes } from "./diagnostics/codes.ts";
import type { Diagnostic } from "./diagnostics/diagnostic.ts";
import { isAssignable } from "./types/assignability.ts";
import { requiredType } from "./types/factory.ts";
import type { WizType } from "./types/type.ts";

export interface CheckOptions {
    allowAny?: boolean;
    implicitAny?: boolean;
    unknownCommands?: "allow" | "warning" | "error";
}

const knownCommands = new Set([
    ".",
    ":",
    "[",
    "[[",
    "alias",
    "bg",
    "break",
    "builtin",
    "caller",
    "cd",
    "command",
    "compgen",
    "complete",
    "continue",
    "declare",
    "dirs",
    "disown",
    "echo",
    "enable",
    "eval",
    "exec",
    "exit",
    "export",
    "false",
    "fg",
    "getopts",
    "hash",
    "help",
    "history",
    "if",
    "then",
    "elif",
    "else",
    "fi",
    "for",
    "select",
    "while",
    "until",
    "do",
    "done",
    "case",
    "in",
    "esac",
    "function",
    "time",
    "coproc",
    "jobs",
    "kill",
    "let",
    "local",
    "mapfile",
    "popd",
    "printf",
    "pushd",
    "pwd",
    "read",
    "readarray",
    "readonly",
    "return",
    "set",
    "shift",
    "shopt",
    "source",
    "suspend",
    "test",
    "times",
    "trap",
    "true",
    "type",
    "typeset",
    "ulimit",
    "umask",
    "unalias",
    "unset",
    "wait",
]);

function checkCall(
    statement: Extract<Statement, { kind: "CommandStatement" }>,
    functionDeclaration: FunctionDeclaration,
    file: SourceFile,
    binding: BindingResult,
    diagnostics: Diagnostic[],
    allowExtra = false,
    scopeOverride?: Scope,
): void {
    // biome-ignore format: Keep the transformed argument list visually distinct.
    const argumentsWithoutRedirections = commandArguments(
        statement.arguments,
    );

    const restParameter = functionDeclaration.parameters.at(-1)?.rest
        ? functionDeclaration.parameters.at(-1)
        : undefined;

    const required = functionDeclaration.parameters.filter((parameter) => {
        return !parameter.optional;
    }).length;

    if (argumentsWithoutRedirections.length < required) {
        diagnostics.push({
            code: DiagnosticCodes.tooFewArguments,
            message: `${functionDeclaration.name} expects at least ${required} argument${required === 1 ? "" : "s"}, but received ${argumentsWithoutRedirections.length}`,
            severity: "error",
            phase: "type",
            fileName: file.fileName,
            range: statement.range,
        });
    }

    if (
        !allowExtra &&
        restParameter === undefined &&
        argumentsWithoutRedirections.length >
            functionDeclaration.parameters.length
    ) {
        diagnostics.push({
            code: DiagnosticCodes.tooManyArguments,
            message: `${functionDeclaration.name} expects at most ${functionDeclaration.parameters.length} arguments, but received ${argumentsWithoutRedirections.length}`,
            severity: "error",
            phase: "type",
            fileName: file.fileName,
            range: statement.range,
        });
    }

    for (
        let index = 0;
        index < argumentsWithoutRedirections.length;
        index += 1
    ) {
        const argument = argumentsWithoutRedirections[index];

        const parameter =
            functionDeclaration.parameters[index] ?? restParameter;

        if (argument === undefined || parameter === undefined) {
            continue;
        }

        const expected =
            parameter.rest && parameter.type.kind === "array"
                ? parameter.type.element
                : parameter.type;

        const actual = inferArgument(
            argument.value,
            scopeOverride ??
                binding.nodeScopes.get(statement) ??
                binding.globalScope,
            expected?.kind === "literal" || expected?.kind === "union",
        );

        if (expected !== undefined && !isAssignable(actual, expected)) {
            diagnostics.push({
                code: DiagnosticCodes.typeMismatch,
                message: `Argument ${index + 1} of ${functionDeclaration.name} expects ${expected.name}, but received ${actual.name}`,
                severity: "error",
                phase: "type",
                fileName: file.fileName,
                range: argument.range,
            });
        }
    }
}

function signatureForArguments(
    primary: CommandSignature,
    overloads: readonly CommandSignature[],
    argumentCount: number,
): CommandSignature {
    const candidates = [primary, ...overloads];

    return (
        candidates.find((signature) => {
            const required = signature.parameters.filter((parameter) => {
                return !parameter.optional;
            }).length;

            const maximum = signature.parameters.at(-1)?.rest
                ? Number.POSITIVE_INFINITY
                : signature.parameters.length;

            return argumentCount >= required && argumentCount <= maximum;
        }) ?? primary
    );
}

function legacySignature(
    declaration: FunctionDeclaration,
): FunctionDeclaration | undefined {
    const assertions = declaration.body.filter((statement) => {
        return (
            statement.kind === "TypedVariableDeclaration" &&
            statement.positionalParameter !== undefined
        );
    });

    const highest = Math.max(
        0,
        ...assertions.map((assertion) => {
            return assertion.kind === "TypedVariableDeclaration"
                ? (assertion.positionalParameter ?? 0)
                : 0;
        }),
    );

    if (highest === 0) {
        return undefined;
    }

    const parameters: FunctionParameter[] = [];

    for (let position = 1; position <= highest; position += 1) {
        const assertion = assertions.find((candidate) => {
            return (
                candidate.kind === "TypedVariableDeclaration" &&
                candidate.positionalParameter === position
            );
        });

        parameters.push({
            kind: "FunctionParameter",
            name: `$${position}`,
            type:
                assertion?.kind === "TypedVariableDeclaration"
                    ? assertion.type
                    : requiredType("any"),
            optional: false,
            range: assertion?.range ?? declaration.range,
            text: assertion?.text ?? `$${position}`,
        });
    }

    return {
        ...declaration,
        parameters,
    };
}

function checkExternalCommand(
    statement: Extract<Statement, { kind: "CommandStatement" }>,
    declaration: ExternalCommandDeclaration,
    file: SourceFile,
    binding: BindingResult,
    diagnostics: Diagnostic[],
): void {
    const statementScope =
        binding.nodeScopes.get(statement) ?? binding.globalScope;

    if (declaration.direct) {
        const parsed = checkCommandOptions(
            statement,
            declaration.options ?? [],
            file,
            binding,
            diagnostics,
            statementScope,
        );

        const selected = signatureForArguments(
            {
                kind: "CommandSignature",
                parameters: declaration.parameters,
                resultType: declaration.resultType,
                text: declaration.text,
                range: declaration.range,
            },
            declaration.overloads ?? [],
            parsed.arguments.length,
        );

        checkCall(
            { ...statement, arguments: parsed.arguments },
            {
                kind: "FunctionDeclaration",
                name: declaration.name,
                parameters: selected.parameters,
                resultType: selected.resultType,
                bodyRange: declaration.range,
                bodyText: "",
                body: [],
                typed: true,
                text: declaration.text,
                range: declaration.range,
            },
            file,
            binding,
            diagnostics,
            false,
            statementScope,
        );

        return;
    }

    const methodName = statement.arguments[0]?.value;

    const method = declaration.methods.find((candidate) => {
        return candidate.name === methodName;
    });

    if (method === undefined) {
        return;
    }

    const methodCall = {
        ...statement,
        arguments: statement.arguments.slice(1),
    };

    const parsed = checkCommandOptions(
        methodCall,
        [...(declaration.options ?? []), ...(method.options ?? [])],
        file,
        binding,
        diagnostics,
        statementScope,
    );

    const selected = signatureForArguments(
        {
            kind: "CommandSignature",
            parameters: method.parameters,
            resultType: method.resultType,
            text: method.text,
            range: method.range,
        },
        method.overloads ?? [],
        parsed.arguments.length,
    );

    const synthetic: FunctionDeclaration = {
        kind: "FunctionDeclaration",
        name: `${declaration.name} ${method.name}`,
        parameters: selected.parameters,
        resultType: selected.resultType,
        bodyRange: method.range,
        bodyText: "",
        body: [],
        typed: true,
        text: method.text,
        range: method.range,
    };

    const call = { ...statement, arguments: parsed.arguments };

    checkCall(
        call,
        synthetic,
        file,
        binding,
        diagnostics,
        false,
        statementScope,
    );
}

function checkAssignment(
    statement: Extract<Statement, { kind: "CommandStatement" }>,
    file: SourceFile,
    binding: BindingResult,
    diagnostics: Diagnostic[],
    options: CheckOptions,
): void {
    const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(
        statement.name,
    );

    if (assignment === null || statement.arguments.length > 0) {
        return;
    }

    const scope = binding.nodeScopes.get(statement) ?? binding.globalScope;

    const symbol = scope.resolve(assignment[1] ?? "");

    if (symbol === undefined || symbol.type.name === "unknown") {
        return;
    }

    if (symbol.type.name === "any") {
        if (options.implicitAny === false) {
            diagnostics.push({
                code: DiagnosticCodes.invalidType,
                message: `Variable ${symbol.name} is inferred with type any`,
                severity: "error",
                phase: "type",
                fileName: file.fileName,
                range: statement.range,
            });
        }

        return;
    }

    const actual = inferArgument(assignment[2] ?? "", scope);

    if (!isAssignable(actual, symbol.type)) {
        diagnostics.push({
            code: DiagnosticCodes.typeMismatch,
            message: `Cannot assign ${actual.name} to ${symbol.type.name} ${symbol.name}`,
            severity: "error",
            phase: "type",
            fileName: file.fileName,
            range: statement.range,
        });
    }
}

function checkArithmetic(
    statement: Extract<Statement, { kind: "CommandStatement" }>,
    file: SourceFile,
    binding: BindingResult,
    diagnostics: Diagnostic[],
): void {
    const arithmetic = /^\s*\(\(([\s\S]*)\)\)\s*$/.exec(statement.text);

    if (arithmetic === null) {
        return;
    }

    const scope = binding.nodeScopes.get(statement) ?? binding.globalScope;

    const identifiers = (arithmetic[1] ?? "").matchAll(
        /[A-Za-z_][A-Za-z0-9_]*/g,
    );

    for (const identifier of identifiers) {
        const symbol = scope.resolve(identifier[0]);

        if (
            symbol !== undefined &&
            !["int", "bool", "status", "any"].includes(symbol.type.name)
        ) {
            diagnostics.push({
                code: DiagnosticCodes.typeMismatch,
                message: `Arithmetic operand ${symbol.name} must be numeric-compatible, but has type ${symbol.type.name}`,
                severity: "error",
                phase: "type",
                fileName: file.fileName,
                range: statement.range,
            });
        }
    }
}

function checkUnknownCommand(
    statement: Extract<Statement, { kind: "CommandStatement" }>,
    file: SourceFile,
    binding: BindingResult,
    diagnostics: Diagnostic[],
    options: CheckOptions,
): void {
    const behavior = options.unknownCommands ?? "allow";

    if (
        behavior === "allow" ||
        knownCommands.has(statement.name) ||
        statement.name.includes("=") ||
        statement.name.startsWith("$(") ||
        statement.name.startsWith("((") ||
        statement.name.endsWith(")")
    ) {
        return;
    }

    const scope = binding.nodeScopes.get(statement) ?? binding.globalScope;

    if (scope.resolve(statement.name) !== undefined) {
        return;
    }

    diagnostics.push({
        code: DiagnosticCodes.undefinedFunction,
        message: `Command has no Wiz declaration: ${statement.name}`,
        severity: behavior,
        phase: "type",
        fileName: file.fileName,
        range: statement.range,
    });
}

function checkExplicitAny(
    statement: Statement,
    file: SourceFile,
    diagnostics: Diagnostic[],
    options: CheckOptions,
): void {
    if (options.allowAny !== false) {
        return;
    }

    const ranges: Array<{
        name: string;
        type: WizType;
        range: Statement["range"];
    }> = [];

    if (statement.kind === "TypedVariableDeclaration") {
        ranges.push({
            name: statement.name ?? "positional parameter",
            type: statement.type,
            range: statement.range,
        });
    } else if (statement.kind === "FunctionDeclaration") {
        for (const parameter of statement.parameters) {
            ranges.push({
                name: parameter.name,
                type: parameter.type,
                range: parameter.range,
            });
        }
    }

    for (const item of ranges) {
        if (item.type.name === "any") {
            diagnostics.push({
                code: DiagnosticCodes.invalidType,
                message: `Explicit any is disabled for ${item.name}`,
                severity: "error",
                phase: "type",
                fileName: file.fileName,
                range: item.range,
            });
        }
    }
}

function checkFunctionSignature(
    statement: FunctionDeclaration,
    file: SourceFile,
    binding: BindingResult,
    diagnostics: Diagnostic[],
): void {
    if (
        ![
            "status",
            "string",
            "stream",
            "void",
            "path",
            "file",
            "directory",
            "bytes",
        ].includes(statement.resultType.name)
    ) {
        diagnostics.push({
            code: DiagnosticCodes.invalidType,
            message: `Function ${statement.name} has unsupported result type ${statement.resultType.name}`,
            severity: "error",
            phase: "type",
            fileName: file.fileName,
            range: statement.range,
        });
    }

    let optionalSeen = false;

    const scope = binding.nodeScopes.get(statement) ?? binding.globalScope;

    for (const parameter of statement.parameters) {
        if (parameter.optional) {
            optionalSeen = true;
        } else if (optionalSeen) {
            diagnostics.push({
                code: DiagnosticCodes.invalidType,
                message: `Required parameter ${parameter.name} cannot follow an optional parameter`,
                severity: "error",
                phase: "type",
                fileName: file.fileName,
                range: parameter.range,
            });
        }

        if (parameter.defaultValue === undefined) {
            continue;
        }

        const actual = inferArgument(parameter.defaultValue, scope);

        if (!isAssignable(actual, parameter.type)) {
            diagnostics.push({
                code: DiagnosticCodes.typeMismatch,
                message: `Default for ${parameter.name} expects ${parameter.type.name}, but received ${actual.name}`,
                severity: "error",
                phase: "type",
                fileName: file.fileName,
                range: parameter.range,
            });
        }
    }
}

function checkStatements(
    statements: readonly Statement[],
    file: SourceFile,
    binding: BindingResult,
    diagnostics: Diagnostic[],
    options: CheckOptions,
): void {
    for (const statement of statements) {
        checkExplicitAny(statement, file, diagnostics, options);

        if (
            statement.kind === "TypedVariableDeclaration" &&
            statement.initializer !== undefined
        ) {
            const scope =
                binding.nodeScopes.get(statement) ?? binding.globalScope;

            if (
                checkCollectionInitializer(statement, file, scope, diagnostics)
            ) {
                continue;
            }

            const source = inferArgument(statement.initializer, scope);

            if (
                source.name !== "unknown" &&
                !isAssignable(source, statement.type)
            ) {
                diagnostics.push({
                    code: DiagnosticCodes.typeMismatch,
                    message: `Cannot assign ${source.name} to ${statement.type.name}${statement.name === undefined ? "" : ` ${statement.name}`}`,
                    severity: "error",
                    phase: "type",
                    fileName: file.fileName,
                    range: statement.range,
                });
            }
        } else if (statement.kind === "CommandStatement") {
            checkAssignment(statement, file, binding, diagnostics, options);

            checkArithmetic(statement, file, binding, diagnostics);

            checkOpaqueBytesUsage(statement, file, binding, diagnostics);

            checkUnknownCommand(statement, file, binding, diagnostics, options);

            const symbol = (
                binding.nodeScopes.get(statement) ?? binding.globalScope
            ).resolve(statement.name);

            if (
                symbol !== undefined &&
                (symbol.flags & SymbolFlags.Function) !== 0 &&
                symbol.declaration.kind === "FunctionDeclaration"
            ) {
                const declaration = symbol.declaration as FunctionDeclaration;

                const signature = declaration.typed
                    ? declaration
                    : legacySignature(declaration);

                if (signature !== undefined) {
                    checkCall(
                        statement,
                        signature,
                        file,
                        binding,
                        diagnostics,
                        !declaration.typed,
                    );
                }
            } else if (
                symbol !== undefined &&
                (symbol.flags & SymbolFlags.ExternalCommand) !== 0 &&
                symbol.declaration.kind === "ExternalCommandDeclaration"
            ) {
                checkExternalCommand(
                    statement,
                    symbol.declaration as ExternalCommandDeclaration,
                    file,
                    binding,
                    diagnostics,
                );
            }
        } else if (statement.kind === "FunctionDeclaration") {
            checkFunctionSignature(statement, file, binding, diagnostics);

            checkStatements(
                statement.body,
                file,
                binding,
                diagnostics,
                options,
            );
        }
    }
}

export interface CheckResult {
    file: SourceFile;
    binding: BindingResult;
    diagnostics: readonly Diagnostic[];
}

/** Checks assignments and known command/function calls for one bound source file. */
export function checkSourceFile(
    file: SourceFile,
    binding: BindingResult,
    options: CheckOptions = {},
): CheckResult {
    const diagnostics: Diagnostic[] = [];

    checkStatements(file.statements, file, binding, diagnostics, options);

    return { file, binding, diagnostics };
}
