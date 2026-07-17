import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
    bindSourceFile,
    checkSourceFile,
    createStandardLibraryScope,
    type Diagnostic,
    parseSourceFile,
    Scope,
    type SourceFile,
    type Statement,
} from "@wiz/compiler";
import type { LinterOptions } from "@wiz/linter";
import { lintSourceFile } from "@wiz/linter";
import type { DocumentSnapshot } from "./snapshot.ts";

interface SourceDocument {
    uri: string;
    fileName: string;
    version: number;
    text: string;
    file: SourceFile;
}

interface SourceSpecifier {
    value: string;
    typeOnly: boolean;
    imports?: readonly string[];
}

function uriPath(uri: string): string {
    if (!uri.startsWith("file:")) {
        return uri;
    }

    return decodeURIComponent(new URL(uri).pathname);
}

function unquote(value: string): string {
    const quote = value[0];

    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
        return value.slice(1, -1);
    }

    return value;
}

function sourceSpecifiers(statements: readonly Statement[]): SourceSpecifier[] {
    const specifiers: SourceSpecifier[] = [];

    for (const statement of statements) {
        if (statement.kind === "FunctionDeclaration") {
            specifiers.push(...sourceSpecifiers(statement.body));

            continue;
        }

        if (statement.kind === "TypeImportDeclaration") {
            specifiers.push({
                value: statement.specifier,
                typeOnly: true,
            });

            continue;
        }

        if (statement.kind === "SourceImportDeclaration") {
            specifiers.push({
                value: statement.specifier,
                typeOnly: false,
                imports: statement.imports,
            });

            continue;
        }

        if (
            statement.kind !== "CommandStatement" ||
            (statement.name !== "source" && statement.name !== ".")
        ) {
            continue;
        }

        const argument = statement.arguments[0];

        if (argument === undefined) {
            continue;
        }

        const specifier = unquote(argument.value);

        if (!specifier.includes("$") && !specifier.includes("`")) {
            specifiers.push({
                value: specifier,
                typeOnly: false,
            });
        }
    }

    return specifiers;
}

function dependencyPath(
    source: SourceDocument,
    sourceSpecifier: SourceSpecifier,
): string | undefined {
    if (!source.uri.startsWith("file:")) {
        return undefined;
    }

    const specifier = sourceSpecifier.value;

    if (sourceSpecifier.typeOnly) {
        const parts = specifier.split("/");

        const packageName = specifier.startsWith("@")
            ? parts.slice(0, 2).join("/")
            : (parts[0] ?? specifier);

        const subpath = specifier.startsWith("@")
            ? parts.slice(2).join("/")
            : parts.slice(1).join("/");

        let directory = dirname(source.fileName);

        while (true) {
            for (const modulesDirectory of ["wiz_modules", "node_modules"]) {
                const root = resolve(directory, modulesDirectory, packageName);

                const candidates =
                    subpath.length === 0
                        ? [resolve(root, "index.d.wiz")]
                        : [
                              resolve(root, `${subpath}.d.wiz`),
                              resolve(root, subpath, "index.d.wiz"),
                          ];

                const match = candidates.find((candidate) => {
                    return existsSync(candidate);
                });

                if (match !== undefined) {
                    return match;
                }
            }

            const parent = dirname(directory);

            if (parent === directory) {
                return undefined;
            }

            directory = parent;
        }
    }

    const absolute = resolve(dirname(source.fileName), specifier);

    if (absolute.endsWith(".wiz")) {
        return absolute;
    }

    if ([".sh", ".zsh"].includes(extname(absolute))) {
        const declaration = absolute.replace(/\.(?:sh|zsh)$/, ".d.wiz");

        return existsSync(declaration) ? declaration : undefined;
    }

    return undefined;
}

function diskDocument(fileName: string): SourceDocument | undefined {
    if (!existsSync(fileName)) {
        return undefined;
    }

    const text = readFileSync(fileName, "utf8");

    return {
        uri: pathToFileURL(fileName).href,
        fileName,
        version: 0,
        text,
        file: parseSourceFile(text, fileName),
    };
}

/** Owns editor buffers plus recursively discovered, disk-backed source snapshots. */
export class DocumentStore {
    private readonly documents = new Map<string, DocumentSnapshot>();
    private readonly openDocuments = new Map<string, SourceDocument>();
    private linterOptions: LinterOptions = {};

    configure(linterOptions: LinterOptions): void {
        this.linterOptions = linterOptions;

        this.rebuild();
    }

    update(uri: string, text: string, version = 0): DocumentSnapshot {
        const fileName = uriPath(uri);

        this.openDocuments.set(uri, {
            uri,
            fileName,
            text,
            version,
            file: parseSourceFile(text, fileName),
        });

        this.rebuild();

        const snapshot = this.documents.get(uri);

        if (snapshot === undefined) {
            throw new Error(`Failed to update document: ${uri}`);
        }

        return snapshot;
    }

    get(uri: string): DocumentSnapshot | undefined {
        return this.documents.get(uri);
    }

    close(uri: string): void {
        this.openDocuments.delete(uri);

        // A closed dependency remains visible only while another open source imports it.
        this.rebuild();
    }

    refresh(): void {
        this.rebuild();
    }

    values(): readonly DocumentSnapshot[] {
        return [...this.documents.values()];
    }

    private collectSources(): readonly SourceDocument[] {
        const discovered = new Map(this.openDocuments);

        const ordered: SourceDocument[] = [];

        const visiting = new Set<string>();

        const visited = new Set<string>();

        const visit = (source: SourceDocument): void => {
            if (visited.has(source.uri) || visiting.has(source.uri)) {
                return;
            }

            visiting.add(source.uri);

            for (const specifier of sourceSpecifiers(source.file.statements)) {
                const fileName = dependencyPath(source, specifier);

                if (fileName === undefined) {
                    continue;
                }

                const uri = pathToFileURL(fileName).href;

                const dependency =
                    this.openDocuments.get(uri) ??
                    discovered.get(uri) ??
                    diskDocument(fileName);

                if (dependency === undefined) {
                    continue;
                }

                discovered.set(uri, dependency);

                visit(dependency);
            }

            visiting.delete(source.uri);

            visited.add(source.uri);

            ordered.push(source);
        };

        for (const source of this.openDocuments.values()) {
            visit(source);
        }

        return ordered;
    }

    private rebuild(): void {
        const sources = this.collectSources();

        const ambientScope = new Scope(createStandardLibraryScope());

        const bindings = new Map<string, ReturnType<typeof bindSourceFile>>();

        const sourcesByFile = new Map(
            sources.map((source) => {
                return [source.fileName, source] as const;
            }),
        );

        for (const source of sources) {
            if (!source.file.declarationFile) {
                continue;
            }

            bindings.set(source.uri, bindSourceFile(source.file, ambientScope));
        }

        // Dependencies bind first so importer calls receive definitions and references.
        for (const source of sources) {
            if (source.file.declarationFile) {
                continue;
            }

            const fileScope = new Scope(ambientScope);

            const importDiagnostics: Diagnostic[] = [];

            for (const specifier of sourceSpecifiers(source.file.statements)) {
                if (specifier.typeOnly) {
                    continue;
                }

                const dependencyFile = dependencyPath(source, specifier);

                const dependency =
                    dependencyFile === undefined
                        ? undefined
                        : sourcesByFile.get(dependencyFile);

                const dependencyBinding =
                    dependency === undefined
                        ? undefined
                        : bindings.get(dependency.uri);

                if (
                    dependencyBinding === undefined ||
                    dependency?.file.declarationFile
                ) {
                    continue;
                }

                const available =
                    specifier.imports === undefined
                        ? dependencyBinding.globalScope.symbols
                        : dependencyBinding.exports;

                const names = specifier.imports ?? [...available.keys()];

                for (const name of names) {
                    const symbol = available.get(name);

                    if (symbol !== undefined) {
                        fileScope.symbols.set(name, symbol);
                    } else if (specifier.imports !== undefined) {
                        importDiagnostics.push({
                            code: "WIZ3004",
                            message: `Module does not export ${name}`,
                            severity: "error",
                            phase: "binding",
                            fileName: source.fileName,
                            range: source.file.statements.find((statement) => {
                                return (
                                    statement.kind ===
                                        "SourceImportDeclaration" &&
                                    statement.specifier === specifier.value
                                );
                            })?.range ?? { start: 0, end: 0 },
                        });
                    }
                }
            }

            const binding = bindSourceFile(source.file, fileScope);

            bindings.set(source.uri, {
                ...binding,
                diagnostics: [...binding.diagnostics, ...importDiagnostics],
            });
        }

        this.documents.clear();

        for (const source of sources) {
            const binding = bindings.get(source.uri);

            if (binding === undefined) {
                continue;
            }

            const check = checkSourceFile(source.file, binding);

            this.documents.set(source.uri, {
                ...source,
                binding,
                check,
                lint: lintSourceFile(source.file, this.linterOptions, binding),
            });
        }
    }
}
