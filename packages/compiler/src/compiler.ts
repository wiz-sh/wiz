import { isAbsolute, join, resolve } from "node:path";
import type { RuntimeChecks } from "@wiz/config";
import type { SourceFile } from "./ast/source-file.ts";
import { type BindingResult, bindSourceFile } from "./binding/binder.ts";
import { Scope } from "./binding/scope.ts";
import { type CheckResult, checkSourceFile } from "./checker.ts";
import { DiagnosticCodes } from "./diagnostics/codes.ts";
import type { Diagnostic } from "./diagnostics/diagnostic.ts";
import { deduplicateDiagnostics } from "./diagnostics/diagnostic.ts";
import type { ProgramEmitResult } from "./emission/emit-result.ts";
import { emitCheckedProgram } from "./emission/emitter.ts";
import { type CompilerHost, createCompilerHost } from "./host.ts";
import { parseSourceFile } from "./parser/parser.ts";
import {
    createStandardLibraryScope,
    standardLibrariesForTarget,
} from "./standard-library.ts";
import type { ShellTargetName } from "./target/backend.ts";
import { validateTargetFeatures } from "./target/validation.ts";

export interface CompilerOptions {
    target?: ShellTargetName;
    rootDir?: string;
    outDir?: string;
    sourceMap?: boolean;
    noEmitOnError?: boolean;
    runtimeChecks?: RuntimeChecks;
    strict?: boolean;
    allowAny?: boolean;
    implicitAny?: boolean;
    unknownCommands?: "allow" | "warning" | "error";
    checkSourcedFiles?: boolean;
    checkDeclarationFiles?: boolean;
    bundle?: boolean;
    minify?: boolean;
    types?: readonly string[];
    projectRoot?: string;
}

export interface Program {
    rootNames: readonly string[];
    sourceFiles: readonly SourceFile[];
    bindings: ReadonlyMap<string, BindingResult>;
    options: CompilerOptions;
    moduleImports: ReadonlyMap<string, readonly ResolvedModuleImport[]>;
    projectDiagnostics: readonly Diagnostic[];
}

export interface CheckedProgram extends Program {
    checks: ReadonlyMap<string, CheckResult>;
    diagnostics: readonly Diagnostic[];
}

interface SourceReference {
    specifier?: string;
    typePackage?: string;
    imports?: readonly string[];
    dynamic: boolean;
    range: { start: number; end: number };
}

export interface ResolvedModuleImport {
    sourceFile: string;
    dependencyFile: string;
    imports?: readonly string[];
    range: { start: number; end: number };
}

const builtInTypePackages = new Set([
    "@types/shell/bash",
    "@types/shell/zsh",
    "@types/shell/sh",
    "@types/coreutils",
    "@types/wiz",
]);

function packageParts(specifier: string): {
    packageName: string;
    subpath?: string;
} {
    const parts = specifier.split("/");

    if (specifier.startsWith("@")) {
        return {
            packageName: parts.slice(0, 2).join("/"),
            ...(parts.length > 2 ? { subpath: parts.slice(2).join("/") } : {}),
        };
    }

    return {
        packageName: parts[0] ?? specifier,
        ...(parts.length > 1 ? { subpath: parts.slice(1).join("/") } : {}),
    };
}

function typePackagePath(
    specifier: string,
    projectRoot: string,
    host: CompilerHost,
): string | undefined {
    if (specifier.startsWith(".") || isAbsolute(specifier)) {
        const path = resolve(projectRoot, specifier);

        return host.fileExists(path) ? path : undefined;
    }

    const parts = packageParts(specifier);

    for (const modulesDirectory of ["wiz_modules", "node_modules"]) {
        const packageRoot = join(
            projectRoot,
            modulesDirectory,
            parts.packageName,
        );

        const candidates =
            parts.subpath === undefined
                ? [join(packageRoot, "index.d.wiz")]
                : [
                      join(packageRoot, `${parts.subpath}.d.wiz`),
                      join(packageRoot, parts.subpath, "index.d.wiz"),
                  ];

        const match = candidates.find((candidate) => {
            return host.fileExists(candidate);
        });

        if (match !== undefined) {
            return match;
        }
    }

    return undefined;
}

function sourceReferences(file: SourceFile): SourceReference[] {
    const results: SourceReference[] = [];

    function collectSemanticImports(
        statements: SourceFile["statements"],
    ): void {
        for (const statement of statements) {
            if (statement.kind === "TypeImportDeclaration") {
                results.push({
                    typePackage: statement.specifier,
                    dynamic: false,
                    range: statement.range,
                });
            } else if (statement.kind === "SourceImportDeclaration") {
                results.push({
                    specifier: statement.specifier,
                    imports: statement.imports,
                    dynamic: false,
                    range: statement.range,
                });
            } else if (statement.kind === "FunctionDeclaration") {
                collectSemanticImports(statement.body);
            }
        }
    }

    collectSemanticImports(file.statements);

    const pattern = /^\s*(?:source|\.)\s+([^\s;]+)/gm;

    for (const match of file.text.matchAll(pattern)) {
        const raw = match[1] ?? "";

        // Type imports have their own semantic node and never represent runtime sources.
        if (["-T", "-I", "--import"].includes(raw)) {
            continue;
        }

        const start = match.index + (match[0]?.indexOf(raw) ?? 0);

        const quote = raw[0] === '"' || raw[0] === "'" ? raw[0] : undefined;

        const specifier =
            quote !== undefined && raw.endsWith(quote) ? raw.slice(1, -1) : raw;

        const dynamic = specifier.includes("$") || specifier.includes("`");

        results.push({
            ...(dynamic ? {} : { specifier }),
            dynamic,
            range: { start, end: start + raw.length },
        });
    }

    return results;
}

/** Builds a project graph, including literal Wiz sources and legacy declarations. */
export function createProgram(
    rootNames: readonly string[],
    options: CompilerOptions = {},
    host: CompilerHost = createCompilerHost(),
): Program {
    const sourceFiles: SourceFile[] = [];

    const referencesByFile = new Map<string, readonly SourceReference[]>();

    const visited = new Set<string>();

    const active = new Set<string>();

    const projectDiagnostics: Diagnostic[] = [];

    const projectRoot = resolve(options.projectRoot ?? options.rootDir ?? ".");

    function visit(path: string): void {
        const absolute = resolve(path);

        if (visited.has(absolute)) {
            return;
        }

        visited.add(absolute);

        active.add(absolute);

        const text = host.readFile(absolute);

        if (text === undefined) {
            active.delete(absolute);

            return;
        }

        const file =
            host.parseSourceFile?.(absolute, text) ??
            parseSourceFile(text, absolute);

        sourceFiles.push(file);

        const references = sourceReferences(file);

        referencesByFile.set(absolute, references);

        // Literal sources are safe to follow statically; dynamic paths remain runtime-only.
        for (const reference of references) {
            if (reference.typePackage !== undefined) {
                const declaration = typePackagePath(
                    reference.typePackage,
                    projectRoot,
                    host,
                );

                if (declaration === undefined) {
                    projectDiagnostics.push({
                        code: DiagnosticCodes.unresolvedSource,
                        message: `Type package was not found: ${reference.typePackage}`,
                        severity: "error",
                        phase: "type",
                        fileName: file.fileName,
                        range: reference.range,
                    });
                } else {
                    visit(declaration);
                }

                continue;
            }

            if (reference.dynamic) {
                projectDiagnostics.push({
                    code: DiagnosticCodes.dynamicSource,
                    message:
                        "Dynamic source path cannot be resolved statically",
                    severity: "warning",
                    phase: "type",
                    fileName: file.fileName,
                    range: reference.range,
                });

                continue;
            }

            const specifier = reference.specifier;

            if (specifier === undefined) {
                continue;
            }

            if (specifier.endsWith(".wiz")) {
                const dependency = host.resolvePath(specifier, absolute);

                if (options.bundle === true && active.has(dependency)) {
                    projectDiagnostics.push({
                        code: DiagnosticCodes.circularSource,
                        message: `Circular bundled source dependency: ${specifier}`,
                        severity: "error",
                        phase: "type",
                        fileName: file.fileName,
                        range: reference.range,
                    });
                } else if (host.fileExists(dependency)) {
                    visit(dependency);
                } else if (options.checkSourcedFiles !== false) {
                    projectDiagnostics.push({
                        code: DiagnosticCodes.unresolvedSource,
                        message: `Sourced Wiz file was not found: ${specifier}`,
                        severity: "error",
                        phase: "type",
                        fileName: file.fileName,
                        range: reference.range,
                    });
                }
            } else if (
                specifier.endsWith(".sh") ||
                specifier.endsWith(".zsh")
            ) {
                const source = host.resolvePath(specifier, absolute);

                if (options.bundle === true) {
                    if (active.has(source)) {
                        projectDiagnostics.push({
                            code: DiagnosticCodes.circularSource,
                            message: `Circular bundled source dependency: ${specifier}`,
                            severity: "error",
                            phase: "type",
                            fileName: file.fileName,
                            range: reference.range,
                        });
                    } else if (host.fileExists(source)) {
                        visit(source);
                    } else {
                        projectDiagnostics.push({
                            code: DiagnosticCodes.unresolvedSource,
                            message: `Bundled shell source was not found: ${specifier}`,
                            severity: "error",
                            phase: "type",
                            fileName: file.fileName,
                            range: reference.range,
                        });
                    }
                }

                const declaration = host.resolvePath(
                    specifier.replace(/\.(?:sh|zsh)$/, ".d.wiz"),
                    absolute,
                );

                if (host.fileExists(declaration)) {
                    visit(declaration);
                } else if (options.checkDeclarationFiles === true) {
                    projectDiagnostics.push({
                        code: DiagnosticCodes.unresolvedSource,
                        message: `Declaration file was not found for ${specifier}`,
                        severity: "warning",
                        phase: "type",
                        fileName: file.fileName,
                        range: reference.range,
                    });
                }
            }
        }

        active.delete(absolute);
    }

    for (const rootName of rootNames) {
        visit(rootName);
    }

    for (const specifier of options.types ?? []) {
        if (builtInTypePackages.has(specifier)) {
            continue;
        }

        const declaration = typePackagePath(specifier, projectRoot, host);

        if (declaration === undefined) {
            projectDiagnostics.push({
                code: DiagnosticCodes.unresolvedSource,
                message: `Type package was not found: ${specifier}`,
                severity: "error",
                phase: "type",
                fileName: join(projectRoot, "config.wiz.json"),
                range: { start: 0, end: 0 },
            });

            continue;
        }

        visit(declaration);
    }

    const ambientScope = new Scope(
        createStandardLibraryScope(
            standardLibrariesForTarget(options.target ?? "bash"),
        ),
    );

    const bindings = new Map<string, BindingResult>();

    for (const file of sourceFiles) {
        if (!file.declarationFile) {
            continue;
        }

        bindings.set(
            file.fileName,
            bindSourceFile(file, ambientScope, {
                ...(options.strict === undefined
                    ? {}
                    : { strict: options.strict }),
            }),
        );
    }

    const filesByName = new Map(
        sourceFiles.map((file) => {
            return [resolve(file.fileName), file] as const;
        }),
    );

    const moduleImports = new Map<string, ResolvedModuleImport[]>();

    for (const file of sourceFiles) {
        if (file.declarationFile) {
            continue;
        }

        const imports: ResolvedModuleImport[] = [];

        for (const reference of referencesByFile.get(file.fileName) ?? []) {
            if (
                reference.dynamic ||
                reference.typePackage !== undefined ||
                reference.specifier === undefined ||
                !reference.specifier.endsWith(".wiz")
            ) {
                continue;
            }

            const dependencyFile = host.resolvePath(
                reference.specifier,
                file.fileName,
            );

            if (!filesByName.has(dependencyFile)) {
                continue;
            }

            imports.push({
                sourceFile: file.fileName,
                dependencyFile,
                ...(reference.imports === undefined
                    ? {}
                    : { imports: reference.imports }),
                range: reference.range,
            });
        }

        moduleImports.set(file.fileName, imports);
    }

    const bindingActive = new Set<string>();

    const bindModule = (file: SourceFile): BindingResult => {
        const existing = bindings.get(file.fileName);

        if (existing !== undefined) {
            return existing;
        }

        const fileScope = new Scope(ambientScope);

        if (bindingActive.has(file.fileName)) {
            const fallback = bindSourceFile(file, fileScope, {
                ...(options.strict === undefined
                    ? {}
                    : { strict: options.strict }),
            });

            bindings.set(file.fileName, fallback);

            return fallback;
        }

        bindingActive.add(file.fileName);

        for (const moduleImport of moduleImports.get(file.fileName) ?? []) {
            const dependency = filesByName.get(moduleImport.dependencyFile);

            if (dependency === undefined || dependency.declarationFile) {
                continue;
            }

            const dependencyBinding = bindModule(dependency);

            const available =
                moduleImport.imports === undefined
                    ? dependencyBinding.globalScope.symbols
                    : dependencyBinding.exports;

            const names =
                moduleImport.imports ?? [...available.keys()].toSorted();

            for (const name of names) {
                const symbol = available.get(name);

                if (symbol === undefined) {
                    projectDiagnostics.push({
                        code: DiagnosticCodes.unavailableImport,
                        message: `Module does not export ${name}`,
                        severity: "error",
                        phase: "binding",
                        fileName: file.fileName,
                        range: moduleImport.range,
                    });

                    continue;
                }

                const existingImport = fileScope.symbols.get(name);

                if (existingImport !== undefined && existingImport !== symbol) {
                    projectDiagnostics.push({
                        code: DiagnosticCodes.duplicateSymbol,
                        message: `Imported symbol conflicts with another import: ${name}`,
                        severity: "error",
                        phase: "binding",
                        fileName: file.fileName,
                        range: moduleImport.range,
                    });

                    continue;
                }

                fileScope.symbols.set(name, symbol);
            }
        }

        const binding = bindSourceFile(file, fileScope, {
            ...(options.strict === undefined ? {} : { strict: options.strict }),
        });

        bindings.set(file.fileName, binding);

        bindingActive.delete(file.fileName);

        return binding;
    };

    for (const file of sourceFiles) {
        if (!file.declarationFile) {
            bindModule(file);
        }
    }

    return {
        rootNames: rootNames.map((name) => {
            return resolve(name);
        }),
        sourceFiles,
        bindings,
        options,
        moduleImports,
        projectDiagnostics,
    };
}

/** Runs binding and type checking for every source in a program. */
export function checkProgram(program: Program): CheckedProgram {
    const checks = new Map<string, CheckResult>();

    const diagnostics: Diagnostic[] = [...program.projectDiagnostics];

    for (const file of program.sourceFiles) {
        diagnostics.push(...file.diagnostics);

        diagnostics.push(
            ...validateTargetFeatures(file, program.options.target ?? "bash"),
        );

        const binding = program.bindings.get(file.fileName);

        if (binding === undefined) {
            continue;
        }

        diagnostics.push(...binding.diagnostics);

        const check = checkSourceFile(file, binding, program.options);

        checks.set(file.fileName, check);

        diagnostics.push(...check.diagnostics);
    }

    return {
        ...program,
        checks,
        diagnostics: deduplicateDiagnostics(diagnostics),
    };
}

export function getDiagnostics(
    program: Program | CheckedProgram,
): readonly Diagnostic[] {
    return "diagnostics" in program
        ? program.diagnostics
        : checkProgram(program).diagnostics;
}

/** Emits a checked program through the configured shell target backend. */
export function emitProgram(
    program: Program | CheckedProgram,
): ProgramEmitResult {
    const checked = "diagnostics" in program ? program : checkProgram(program);

    return emitCheckedProgram(checked);
}

/** Compiles an in-memory source, primarily for tools, tests, and embedding. */
export function compileSource(
    text: string,
    fileName = "source.wiz",
    options: CompilerOptions = {},
): ProgramEmitResult {
    const host: CompilerHost = {
        readFile(path) {
            return resolve(path) === resolve(fileName) ? text : undefined;
        },
        fileExists(path) {
            return resolve(path) === resolve(fileName);
        },
        resolvePath(specifier, containingFile) {
            return createCompilerHost().resolvePath(specifier, containingFile);
        },
    };

    return emitProgram(createProgram([fileName], options, host));
}
