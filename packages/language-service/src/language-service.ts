import {
    type AstNode,
    type ExternalCommandDeclaration,
    type FunctionDeclaration,
    type Scope,
    SyntaxKind,
    type TextRange,
} from "@wiz/compiler";
import {
    type FormatOptions,
    type FormatRange,
    formatSourceFile,
} from "@wiz/formatter";
import type { LintDiagnostic } from "@wiz/linter";
import { DocumentStore } from "./document-store.ts";
import {
    containsNode,
    documentationProperty,
    nodeDocumentation,
    ownerOf,
} from "./features/documentation.ts";
import {
    collectSemanticTokens,
    type SemanticTokenInfo,
} from "./features/semantic-tokens.ts";
import { declarationNameRange } from "./features/symbol-ranges.ts";
import type {
    CodeActionInfo,
    CompletionItem,
    DocumentSymbolInfo,
    FoldingRangeInfo,
    HoverInfo,
    InlayHintInfo,
    LanguageServiceConfiguration,
    ServiceDiagnostic,
    ServiceLocation,
    SignatureInfo,
    TextEdit,
    WorkspaceSymbolInfo,
    WorkspaceTextEdit,
} from "./service-types.ts";
import type { DocumentSnapshot } from "./snapshot.ts";

export type { SemanticTokenInfo } from "./features/semantic-tokens.ts";

function wordAt(
    text: string,
    offset: number,
): { word: string; range: TextRange } | undefined {
    if (offset < 0 || offset > text.length) {
        return undefined;
    }

    let start = offset;

    let end = offset;

    while (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1] ?? "")) {
        start -= 1;
    }

    while (end < text.length && /[A-Za-z0-9_]/.test(text[end] ?? "")) {
        end += 1;
    }

    return end === start
        ? undefined
        : { word: text.slice(start, end), range: { start, end } };
}

function allScopes(snapshot: DocumentSnapshot): Scope[] {
    const scopes = new Set<Scope>();

    const addScope = (scope: Scope): void => {
        if (scope.parent !== undefined) {
            addScope(scope.parent);
        }

        scopes.add(scope);
    };

    addScope(snapshot.binding.globalScope);

    for (const scope of snapshot.binding.nodeScopes.values()) {
        addScope(scope);
    }

    return [...scopes];
}

function symbolAt(snapshot: DocumentSnapshot, offset: number) {
    const word = wordAt(snapshot.text, offset);

    if (word === undefined) {
        return undefined;
    }

    for (const scope of allScopes(snapshot).toReversed()) {
        const symbol = scope.symbols.get(word.word);

        if (symbol !== undefined) {
            return { symbol, word };
        }
    }

    return undefined;
}

function signature(declaration: FunctionDeclaration): string {
    const parameters = declaration.parameters.map((parameter) => {
        return `${parameter.rest ? "..." : ""}${parameter.type.name} ${parameter.name}${parameter.defaultValue === undefined ? "" : `=${parameter.defaultValue}`}`;
    });

    return `${declaration.name}(${parameters.join(", ")}): ${declaration.resultType.name}`;
}

function nodeKind(node: AstNode): DocumentSymbolInfo["kind"] | undefined {
    if (node.kind === "FunctionDeclaration") {
        return "function";
    }

    if (node.kind === "TypedVariableDeclaration") {
        return "variable";
    }

    if (node.kind === "EnvironmentDeclaration") {
        return "environment";
    }

    return undefined;
}

function renameableOffset(snapshot: DocumentSnapshot, offset: number): boolean {
    const token = snapshot.file.syntaxTree.tokens.find((candidate) => {
        return offset >= candidate.range.start && offset < candidate.range.end;
    });

    return (
        token?.kind !== SyntaxKind.CommentToken &&
        token?.kind !== SyntaxKind.SingleQuotedToken
    );
}

function commandAtOffset(
    snapshot: DocumentSnapshot,
    offset: number,
):
    | Extract<
          DocumentSnapshot["file"]["statements"][number],
          { kind: "CommandStatement" }
      >
    | undefined {
    const statement = snapshot.file.statements.find((candidate) => {
        return (
            candidate.kind === "CommandStatement" &&
            offset >= candidate.range.start &&
            offset <= candidate.range.end
        );
    });

    return statement?.kind === "CommandStatement" ? statement : undefined;
}

/** Reusable Wiz editor intelligence independent of any transport or editor. */
export class LanguageService {
    readonly documents = new DocumentStore();
    private formatterOptions: FormatOptions = {};
    private configurationDiagnostics: readonly ServiceDiagnostic[] = [];

    configure(configuration: LanguageServiceConfiguration): void {
        this.formatterOptions = configuration.formatter ?? {};

        this.configurationDiagnostics = configuration.diagnostics ?? [];

        this.documents.configure(configuration.linter ?? {});
    }

    updateDocument(uri: string, text: string, version = 0): DocumentSnapshot {
        return this.documents.update(uri, text, version);
    }

    closeDocument(uri: string): void {
        this.documents.close(uri);
    }

    diagnostics(
        uri: string,
    ): readonly (
        | DocumentSnapshot["file"]["diagnostics"][number]
        | LintDiagnostic
        | ServiceDiagnostic
    )[] {
        const snapshot = this.documents.get(uri);

        return snapshot === undefined
            ? []
            : [
                  ...this.configurationDiagnostics,
                  ...snapshot.file.diagnostics,
                  ...snapshot.binding.diagnostics,
                  ...snapshot.check.diagnostics,
                  ...snapshot.lint,
              ];
    }

    hover(uri: string, offset: number): HoverInfo | undefined {
        const snapshot = this.documents.get(uri);

        const found =
            snapshot === undefined ? undefined : symbolAt(snapshot, offset);

        if (found === undefined) {
            return undefined;
        }

        const declaration = found.symbol.declaration;

        const documentation = nodeDocumentation(
            this.documents.values(),
            declaration,
        );

        const contents =
            declaration.kind === "FunctionDeclaration"
                ? signature(declaration as FunctionDeclaration)
                : `${found.symbol.name}: ${found.symbol.type.name}`;

        return {
            contents: `\`\`\`wiz\n${contents}\n\`\`\`${documentation === undefined ? "" : `\n\n${documentation}`}`,
            range: found.word.range,
        };
    }

    definition(uri: string, offset: number): ServiceLocation | undefined {
        const snapshot = this.documents.get(uri);

        const found =
            snapshot === undefined ? undefined : symbolAt(snapshot, offset);

        if (found === undefined || snapshot === undefined) {
            return undefined;
        }

        const owner = ownerOf(
            this.documents.values(),
            found.symbol.declaration,
        );

        return {
            uri: owner?.uri ?? snapshot.uri,
            range: found.symbol.declaration.range,
        };
    }

    references(
        uri: string,
        offset: number,
        includeDeclaration = true,
    ): readonly ServiceLocation[] {
        const snapshot = this.documents.get(uri);

        const found =
            snapshot === undefined ? undefined : symbolAt(snapshot, offset);

        if (found === undefined || snapshot === undefined) {
            return [];
        }

        const nodes = includeDeclaration
            ? [found.symbol.declaration, ...found.symbol.references]
            : found.symbol.references;

        return nodes.map((node) => {
            const owner = this.documents.values().find((document) => {
                return containsNode(document.file.statements, node);
            });

            return { uri: owner?.uri ?? snapshot.uri, range: node.range };
        });
    }

    completions(uri: string, offset?: number): readonly CompletionItem[] {
        const snapshot = this.documents.get(uri);

        const items = new Map<string, CompletionItem>();

        if (snapshot !== undefined) {
            for (const scope of allScopes(snapshot)) {
                for (const symbol of scope.symbols.values()) {
                    const documentation = nodeDocumentation(
                        this.documents.values(),
                        symbol.declaration,
                    );

                    items.set(symbol.name, {
                        label: symbol.name,
                        detail: symbol.type.name,
                        kind: [
                            "FunctionDeclaration",
                            "ExternalCommandDeclaration",
                        ].includes(symbol.declaration.kind)
                            ? "function"
                            : "variable",
                        ...documentationProperty(documentation),
                    });
                }
            }

            const command =
                offset === undefined
                    ? undefined
                    : commandAtOffset(snapshot, offset);

            const symbol =
                command === undefined
                    ? undefined
                    : snapshot.binding.globalScope.resolve(command.name);

            if (
                command !== undefined &&
                symbol?.declaration.kind === "ExternalCommandDeclaration"
            ) {
                const declaration =
                    symbol.declaration as ExternalCommandDeclaration;

                const methodName = command.arguments[0]?.value;

                const method = declaration.methods.find((candidate) => {
                    return candidate.name === methodName;
                });

                for (const option of [
                    ...(declaration.options ?? []),
                    ...(method?.options ?? []),
                ]) {
                    for (const name of option.names) {
                        items.set(name, {
                            label: name,
                            detail:
                                option.valueType === undefined
                                    ? "command option"
                                    : `${option.valueName ?? "value"}: ${option.valueType.name}`,
                            kind: "keyword",
                        });
                    }
                }

                if (!declaration.direct && method === undefined) {
                    for (const candidate of declaration.methods) {
                        items.set(candidate.name, {
                            label: candidate.name,
                            detail: `${declaration.name} subcommand`,
                            kind: "function",
                            ...documentationProperty(
                                nodeDocumentation(
                                    this.documents.values(),
                                    candidate,
                                ),
                            ),
                        });
                    }
                }
            }
        }

        for (const keyword of [
            "declare",
            "local",
            "if",
            "then",
            "fi",
            "for",
            "while",
            "case",
            "source",
            "command",
        ]) {
            items.set(keyword, {
                label: keyword,
                detail: "Wiz keyword",
                kind: "keyword",
            });
        }

        for (const type of [
            "string",
            "int",
            "bool",
            "path",
            "file",
            "directory",
            "bytes",
            "status",
            "stream",
            "void",
            "any",
            "unknown",
            "never",
        ]) {
            items.set(type, { label: type, detail: "Wiz type", kind: "type" });
        }

        return [...items.values()].toSorted((left, right) => {
            return left.label.localeCompare(right.label);
        });
    }

    prepareRename(uri: string, offset: number): TextRange | undefined {
        const snapshot = this.documents.get(uri);

        const found =
            snapshot === undefined ? undefined : symbolAt(snapshot, offset);

        return snapshot !== undefined &&
            found !== undefined &&
            renameableOffset(snapshot, offset)
            ? found.word.range
            : undefined;
    }

    workspaceSymbols(query = ""): readonly WorkspaceSymbolInfo[] {
        const normalized = query.toLowerCase();

        return this.documents.values().flatMap((snapshot) => {
            return this.documentSymbols(snapshot.uri)
                .filter((symbol) => {
                    return symbol.name.toLowerCase().includes(normalized);
                })
                .map((symbol) => {
                    return { ...symbol, uri: snapshot.uri };
                });
        });
    }

    foldingRanges(uri: string): readonly FoldingRangeInfo[] {
        const snapshot = this.documents.get(uri);

        if (snapshot === undefined) {
            return [];
        }

        return snapshot.file.statements.flatMap((statement) => {
            return statement.kind === "FunctionDeclaration"
                ? [{ range: statement.bodyRange }]
                : [];
        });
    }

    selectionRanges(uri: string, offset: number): readonly TextRange[] {
        const snapshot = this.documents.get(uri);

        if (snapshot === undefined) {
            return [];
        }

        const word = wordAt(snapshot.text, offset);

        const statement = snapshot.file.statements.find((candidate) => {
            return (
                offset >= candidate.range.start && offset <= candidate.range.end
            );
        });

        return [
            ...(word === undefined ? [] : [word.range]),
            ...(statement === undefined ? [] : [statement.range]),
            { start: 0, end: snapshot.text.length },
        ];
    }

    inlayHints(uri: string, range?: TextRange): readonly InlayHintInfo[] {
        const snapshot = this.documents.get(uri);

        if (snapshot === undefined) {
            return [];
        }

        return snapshot.file.statements.flatMap((statement) => {
            if (
                statement.kind !== "CommandStatement" ||
                (range !== undefined &&
                    (statement.range.end <= range.start ||
                        statement.range.start >= range.end))
            ) {
                return [];
            }

            const symbol = snapshot.binding.globalScope.resolve(statement.name);

            if (symbol?.declaration.kind !== "FunctionDeclaration") {
                return [];
            }

            const declaration = symbol.declaration as FunctionDeclaration;

            return statement.arguments.flatMap((argument, index) => {
                const parameter = declaration.parameters[index];

                return parameter === undefined
                    ? []
                    : [
                          {
                              position: argument.range.start,
                              label: `${parameter.name}:`,
                          },
                      ];
            });
        });
    }

    signatureHelp(uri: string, offset: number): SignatureInfo | undefined {
        const snapshot = this.documents.get(uri);

        if (snapshot === undefined) {
            return undefined;
        }

        const lineStart =
            snapshot.text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;

        const line = snapshot.text.slice(lineStart, offset).trimStart();

        const startsNextArgument = /\s$/.test(line);

        const words = line.trim().split(/\s+/);

        const activeParameter = (prefixWords: number): number => {
            return Math.max(
                0,
                words.length - prefixWords + (startsNextArgument ? 1 : 0),
            );
        };

        const name = words[0];

        if (name === undefined) {
            return undefined;
        }

        const symbol = snapshot.binding.globalScope.resolve(name);

        if (symbol?.declaration.kind === "ExternalCommandDeclaration") {
            const declaration =
                symbol.declaration as ExternalCommandDeclaration;

            if (declaration.direct) {
                const parameters = declaration.parameters.map((parameter) => {
                    return `${parameter.rest ? "..." : ""}${parameter.name}: ${parameter.type.name}`;
                });

                const documentation = nodeDocumentation(
                    this.documents.values(),
                    declaration,
                );

                return {
                    label: `${declaration.name}(${parameters.join(", ")}): ${declaration.resultType.name}`,
                    parameters,
                    activeParameter: activeParameter(2),
                    ...documentationProperty(documentation),
                };
            }

            const method = declaration.methods.find((candidate) => {
                return candidate.name === words[1];
            });

            if (method === undefined) {
                return undefined;
            }

            const parameters = method.parameters.map((parameter) => {
                return `${parameter.name}: ${parameter.type.name}`;
            });

            const documentation = nodeDocumentation(
                this.documents.values(),
                method,
            );

            return {
                label: `${declaration.name} ${method.name}(${parameters.join(", ")}): ${method.resultType.name}`,
                parameters,
                activeParameter: activeParameter(3),
                ...documentationProperty(documentation),
            };
        }

        if (symbol?.declaration.kind !== "FunctionDeclaration") {
            return undefined;
        }

        const declaration = symbol.declaration as FunctionDeclaration;

        const documentation = nodeDocumentation(
            this.documents.values(),
            declaration,
        );

        return {
            label: signature(declaration),
            parameters: declaration.parameters.map((parameter) => {
                return `${parameter.type.name} ${parameter.name}`;
            }),
            activeParameter: activeParameter(2),
            ...documentationProperty(documentation),
        };
    }

    rename(
        uri: string,
        offset: number,
        newName: string,
    ): readonly WorkspaceTextEdit[] {
        const snapshot = this.documents.get(uri);

        const found =
            snapshot === undefined ? undefined : symbolAt(snapshot, offset);

        if (
            snapshot === undefined ||
            found === undefined ||
            !/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)
        ) {
            return [];
        }

        const edits: WorkspaceTextEdit[] = [];

        const pattern = new RegExp(`\\b${found.symbol.name}\\b`, "g");

        const seen = new Set<string>();

        const ownerOfDeclaration = this.documents.values().find((document) => {
            return containsNode(
                document.file.statements,
                found.symbol.declaration,
            );
        });

        const declarationRange = declarationNameRange(
            found.symbol.declaration,
            found.symbol.name,
        );

        if (
            ownerOfDeclaration !== undefined &&
            declarationRange !== undefined
        ) {
            edits.push({
                uri: ownerOfDeclaration.uri,
                range: declarationRange,
                newText: newName,
            });

            seen.add(`${ownerOfDeclaration.uri}:${declarationRange.start}`);
        }

        for (const node of found.symbol.references) {
            const owner = this.documents.values().find((document) => {
                return containsNode(document.file.statements, node);
            });

            if (owner === undefined) {
                continue;
            }

            const source = owner.text.slice(node.range.start, node.range.end);

            for (const match of source.matchAll(pattern)) {
                const start = node.range.start + match.index;

                const key = `${owner.uri}:${start}`;

                if (seen.has(key)) {
                    continue;
                }

                if (!renameableOffset(owner, start)) {
                    continue;
                }

                seen.add(key);

                edits.push({
                    uri: owner.uri,
                    range: { start, end: start + found.symbol.name.length },
                    newText: newName,
                });
            }
        }

        return edits.toSorted((left, right) => {
            return (
                left.uri.localeCompare(right.uri) ||
                left.range.start - right.range.start
            );
        });
    }

    documentSymbols(uri: string): readonly DocumentSymbolInfo[] {
        const snapshot = this.documents.get(uri);

        if (snapshot === undefined) {
            return [];
        }

        return snapshot.file.statements.flatMap((statement) => {
            const kind = nodeKind(statement);

            const name =
                "name" in statement && typeof statement.name === "string"
                    ? statement.name
                    : undefined;

            return kind === undefined || name === undefined
                ? []
                : [{ name, kind, range: statement.range }];
        });
    }

    semanticTokens(uri: string): readonly SemanticTokenInfo[] {
        const snapshot = this.documents.get(uri);

        if (snapshot === undefined) {
            return [];
        }

        return collectSemanticTokens(snapshot);
    }

    format(
        uri: string,
        options: FormatOptions = {},
        range?: FormatRange,
    ): readonly TextEdit[] {
        const snapshot = this.documents.get(uri);

        if (snapshot === undefined) {
            return [];
        }

        const newText = formatSourceFile(
            snapshot.file,
            { ...this.formatterOptions, ...options },
            range,
        );

        return newText === snapshot.text
            ? []
            : [{ range: { start: 0, end: snapshot.text.length }, newText }];
    }

    codeActions(uri: string): readonly CodeActionInfo[] {
        const snapshot = this.documents.get(uri);

        if (snapshot === undefined) {
            return [];
        }

        return snapshot.lint
            .filter((diagnostic) => {
                return diagnostic.fix !== undefined;
            })
            .map((diagnostic) => {
                return {
                    title: `Fix ${diagnostic.rule}`,
                    kind: "quickfix",
                    diagnostic,
                    ...(diagnostic.fix === undefined
                        ? {}
                        : {
                              edit: {
                                  range: diagnostic.fix.range,
                                  newText: diagnostic.fix.text,
                              },
                          }),
                };
            });
    }
}
