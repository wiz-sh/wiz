import type { AstNode } from "../ast/ast-node.ts";
import type { SourceFile, Statement } from "../ast/source-file.ts";
import { DiagnosticCodes } from "../diagnostics/codes.ts";
import type { Diagnostic } from "../diagnostics/diagnostic.ts";
import { requiredType } from "../types/factory.ts";
import { Scope } from "./scope.ts";
import type { WizSymbol } from "./symbol.ts";
import { SymbolFlags } from "./symbol-flags.ts";

export interface BindingResult {
    globalScope: Scope;
    nodeScopes: ReadonlyMap<AstNode, Scope>;
    exports: ReadonlyMap<string, WizSymbol>;
    diagnostics: readonly Diagnostic[];
}

export interface BindingOptions {
    strict?: boolean;
}

function define(
    scope: Scope,
    symbol: WizSymbol,
    file: SourceFile,
    diagnostics: Diagnostic[],
): void {
    const existing = scope.symbols.get(symbol.name);

    if (existing !== undefined) {
        diagnostics.push({
            code: DiagnosticCodes.duplicateSymbol,
            message: `Duplicate symbol: ${symbol.name}`,
            severity: "error",
            phase: "binding",
            fileName: file.fileName,
            range: symbol.declaration.range,
        });

        return;
    }

    scope.symbols.set(symbol.name, symbol);
}

function bindStatements(
    statements: readonly Statement[],
    scope: Scope,
    file: SourceFile,
    diagnostics: Diagnostic[],
    nodeScopes: Map<AstNode, Scope>,
    options: BindingOptions,
): void {
    function defineVariable(
        name: string,
        declaration: AstNode,
        type = requiredType(options.strict === true ? "unknown" : "any"),
    ): void {
        if (scope.resolve(name) !== undefined) {
            return;
        }

        define(
            scope,
            {
                name,
                flags: SymbolFlags.Variable,
                type,
                declaration,
                references: [],
            },
            file,
            diagnostics,
        );
    }

    for (const statement of statements) {
        nodeScopes.set(statement, scope);

        if (
            statement.kind === "TypedVariableDeclaration" &&
            statement.name !== undefined
        ) {
            define(
                scope,
                {
                    name: statement.name,
                    flags: SymbolFlags.Variable,
                    type: statement.type,
                    declaration: statement,
                    references: [],
                },
                file,
                diagnostics,
            );
        } else if (
            statement.kind === "TypedVariableDeclaration" &&
            statement.positionalParameter !== undefined
        ) {
            define(
                scope,
                {
                    name: String(statement.positionalParameter),
                    flags: SymbolFlags.Parameter,
                    type: statement.type,
                    declaration: statement,
                    references: [],
                },
                file,
                diagnostics,
            );
        } else if (statement.kind === "EnvironmentDeclaration") {
            define(
                scope,
                {
                    name: statement.name,
                    flags: SymbolFlags.Environment,
                    type: statement.type,
                    declaration: statement,
                    references: [],
                },
                file,
                diagnostics,
            );
        } else if (statement.kind === "ExternalCommandDeclaration") {
            define(
                scope,
                {
                    name: statement.name,
                    flags: SymbolFlags.ExternalCommand,
                    type: statement.resultType,
                    declaration: statement,
                    references: [],
                },
                file,
                diagnostics,
            );
        } else if (statement.kind === "FunctionDeclaration") {
            define(
                scope,
                {
                    name: statement.name,
                    flags: SymbolFlags.Function,
                    type: statement.resultType,
                    declaration: statement,
                    references: [],
                },
                file,
                diagnostics,
            );

            const functionScope = new Scope(scope);

            nodeScopes.set(statement, functionScope);

            for (const parameter of statement.parameters) {
                nodeScopes.set(parameter, functionScope);

                define(
                    functionScope,
                    {
                        name: parameter.name,
                        flags: SymbolFlags.Parameter,
                        type: parameter.type,
                        declaration: parameter,
                        references: [],
                    },
                    file,
                    diagnostics,
                );
            }

            bindStatements(
                statement.body,
                functionScope,
                file,
                diagnostics,
                nodeScopes,
                options,
            );
        } else if (statement.kind === "CommandStatement") {
            const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(
                statement.name,
            );

            if (assignment !== null && statement.arguments.length === 0) {
                defineVariable(assignment[1] ?? "", statement);
            }

            if (statement.name === "local" || statement.name === "declare") {
                for (const argument of statement.arguments) {
                    const localAssignment =
                        /^([A-Za-z_][A-Za-z0-9_]*)(?:=|$)/.exec(argument.value);

                    if (localAssignment !== null) {
                        // biome-ignore format: Multi-line calls keep binding branches easy to scan.
                        defineVariable(
                            localAssignment[1] ?? "",
                            statement,
                        );
                    }
                }
            }

            if (statement.name === "export") {
                for (const argument of statement.arguments) {
                    const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(
                        argument.value,
                    );

                    if (assignment !== null) {
                        defineVariable(assignment[1] ?? "", statement);
                    }
                }
            }

            if (statement.name === "for") {
                const name = statement.arguments[0]?.value ?? "";

                if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
                    // Shell loop values are text even when the source list contains numerals.
                    defineVariable(name, statement, requiredType("string"));
                }
            }

            if (
                statement.name === "bytes" &&
                ["capture", "read"].includes(
                    statement.arguments[0]?.value ?? "",
                )
            ) {
                const name = statement.arguments[1]?.value ?? "";

                if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
                    defineVariable(name, statement, requiredType("bytes"));
                }
            }
        }
    }

    for (const statement of statements) {
        const statementScope = nodeScopes.get(statement) ?? scope;

        if (statement.kind === "CommandStatement") {
            const callable = statementScope.resolve(statement.name);

            if (callable !== undefined) {
                callable.references.push(statement);
            }

            const expansion = /\$(?:\{)?([A-Za-z_][A-Za-z0-9_]*)/g;

            for (const match of statement.text.matchAll(expansion)) {
                const symbol = statementScope.resolve(match[1] ?? "");

                if (symbol !== undefined) {
                    symbol.references.push(statement);
                }
            }

            if (statement.name === "export") {
                for (const argument of statement.arguments) {
                    if (argument.value.startsWith("-")) {
                        continue;
                    }

                    const name = argument.value.split("=", 1)[0] ?? "";

                    const symbol = statementScope.resolve(name);

                    if (symbol !== undefined) {
                        symbol.references.push(statement);
                    }
                }
            }
        } else if (statement.kind === "SourceImportDeclaration") {
            for (const name of statement.imports) {
                const symbol = statementScope.resolve(name);

                if (symbol !== undefined) {
                    symbol.references.push(statement);
                }
            }
        }
    }
}

/** Binds declarations and references into a caller-provided project scope. */
export function bindSourceFile(
    file: SourceFile,
    globalScope = new Scope(),
    options: BindingOptions = {},
): BindingResult {
    const diagnostics: Diagnostic[] = [];

    const nodeScopes = new Map<AstNode, Scope>();

    bindStatements(
        file.statements,
        globalScope,
        file,
        diagnostics,
        nodeScopes,
        options,
    );

    const exports = new Map<string, WizSymbol>();

    for (const statement of file.statements) {
        if (
            statement.kind === "TypedVariableDeclaration" &&
            statement.name !== undefined &&
            statement.attributes.includes("x")
        ) {
            const symbol = globalScope.resolve(statement.name);

            if (symbol !== undefined) {
                exports.set(statement.name, symbol);
            }

            continue;
        }

        if (
            statement.kind !== "CommandStatement" ||
            statement.name !== "export"
        ) {
            continue;
        }

        for (const argument of statement.arguments) {
            if (argument.value.startsWith("-")) {
                continue;
            }

            const name = argument.value.split("=", 1)[0] ?? "";

            const symbol = globalScope.resolve(name);

            if (symbol === undefined) {
                diagnostics.push({
                    code: DiagnosticCodes.unknownExport,
                    message: `Cannot export an undefined symbol: ${name}`,
                    severity: "error",
                    phase: "binding",
                    fileName: file.fileName,
                    range: argument.range,
                });

                continue;
            }

            exports.set(name, symbol);
        }
    }

    return { globalScope, nodeScopes, exports, diagnostics };
}

export function intrinsicCommandSymbol(
    name: string,
    declaration: AstNode,
): WizSymbol {
    return {
        name,
        flags: SymbolFlags.ExternalCommand,
        type: requiredType("status"),
        declaration,
        references: [],
    };
}
