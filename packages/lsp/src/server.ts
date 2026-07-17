import { loadConfig } from "@wiz/config";
import {
    LanguageService,
    type ServiceLocation,
    type TextEdit,
} from "@wiz/language-service";
import {
    offsetAt,
    type Position,
    positionAt,
    type Range,
    rangeAt,
} from "./documents.ts";

interface TextDocumentIdentifier {
    uri: string;
}

interface TextDocumentPosition {
    textDocument: TextDocumentIdentifier;
    position: Position;
}

function location(value: ServiceLocation, text: string): object {
    return { uri: value.uri, range: rangeAt(text, value.range) };
}

function edit(value: TextEdit, text: string): object {
    return { range: rangeAt(text, value.range), newText: value.newText };
}

/** Translates LSP requests into language-service operations. */
export class LspServer {
    readonly service: LanguageService;

    constructor(service = new LanguageService()) {
        this.service = service;
    }

    async reloadConfiguration(start = process.cwd()): Promise<void> {
        const loaded = await loadConfig(start);

        this.service.configure({
            formatter: loaded.config.formatter,
            linter: {
                recommended: loaded.config.linter.recommended,
                rules: loaded.config.linter.rules,
            },
            diagnostics: loaded.diagnostics.map((diagnostic) => {
                return {
                    code: diagnostic.code,
                    message: diagnostic.message,
                    severity: diagnostic.severity,
                    range: { start: 0, end: 0 },
                };
            }),
        });
    }

    notify(method: string, params: unknown): void {
        const value = params as {
            textDocument: { uri: string; text?: string; version?: number };
            contentChanges?: Array<{ text: string; range?: Range }>;
        };

        if (
            method === "textDocument/didOpen" &&
            value.textDocument.text !== undefined
        ) {
            this.service.updateDocument(
                value.textDocument.uri,
                value.textDocument.text,
                value.textDocument.version ?? 0,
            );
        } else if (method === "textDocument/didChange") {
            const current = this.service.documents.get(value.textDocument.uri);

            let text = current?.text;

            for (const change of value.contentChanges ?? []) {
                if (change.range === undefined) {
                    text = change.text;

                    continue;
                }

                if (text === undefined) {
                    continue;
                }

                const start = offsetAt(text, change.range.start);

                const end = offsetAt(text, change.range.end);

                text = text.slice(0, start) + change.text + text.slice(end);
            }

            if (text !== undefined) {
                this.service.updateDocument(
                    value.textDocument.uri,
                    text,
                    value.textDocument.version ?? 0,
                );
            }
        } else if (method === "textDocument/didClose") {
            this.service.closeDocument(value.textDocument.uri);
        } else if (method === "workspace/didChangeWatchedFiles") {
            this.service.documents.refresh();
        }
    }

    request(method: string, params: unknown): unknown {
        if (method === "initialize") {
            return {
                capabilities: {
                    textDocumentSync: 2,
                    hoverProvider: true,
                    definitionProvider: true,
                    referencesProvider: true,
                    completionProvider: { triggerCharacters: ["$", " "] },
                    signatureHelpProvider: { triggerCharacters: [" "] },
                    documentSymbolProvider: true,
                    renameProvider: { prepareProvider: true },
                    workspaceSymbolProvider: true,
                    foldingRangeProvider: true,
                    selectionRangeProvider: true,
                    inlayHintProvider: true,
                    semanticTokensProvider: {
                        legend: {
                            tokenTypes: [
                                "comment",
                                "function",
                                "string",
                                "number",
                                "operator",
                                "parameter",
                                "variable",
                            ],
                            tokenModifiers: [],
                        },
                        full: true,
                    },
                    documentFormattingProvider: true,
                    documentRangeFormattingProvider: true,
                    codeActionProvider: true,
                },
                serverInfo: { name: "wiz-language-server", version: "0.1.0" },
            };
        }

        if (method === "shutdown") {
            return null;
        }

        if (method === "workspace/symbol") {
            const query = (params as { query?: string }).query ?? "";

            return this.service.workspaceSymbols(query).map((symbol) => {
                const text = this.service.documents.get(symbol.uri)?.text ?? "";

                return {
                    name: symbol.name,
                    kind: symbol.kind === "function" ? 12 : 13,
                    location: {
                        uri: symbol.uri,
                        range: rangeAt(text, symbol.range),
                    },
                };
            });
        }

        const positionParams = params as TextDocumentPosition;

        const uri = positionParams.textDocument?.uri;

        const snapshot =
            uri === undefined ? undefined : this.service.documents.get(uri);

        if (uri === undefined || snapshot === undefined) {
            return null;
        }

        const offset =
            positionParams.position === undefined
                ? 0
                : offsetAt(snapshot.text, positionParams.position);

        if (method === "textDocument/diagnostic") {
            return {
                kind: "full",
                items: this.service.diagnostics(uri).map((diagnostic) => {
                    return {
                        range: rangeAt(snapshot.text, diagnostic.range),
                        severity: diagnostic.severity === "error" ? 1 : 2,
                        code:
                            "code" in diagnostic
                                ? diagnostic.code
                                : diagnostic.rule,
                        source: "wiz",
                        message: diagnostic.message,
                    };
                }),
            };
        }

        if (method === "textDocument/hover") {
            const hover = this.service.hover(uri, offset);

            return hover === undefined
                ? null
                : {
                      contents: { kind: "markdown", value: hover.contents },
                      range: rangeAt(snapshot.text, hover.range),
                  };
        }

        if (method === "textDocument/definition") {
            const target = this.service.definition(uri, offset);

            const targetText =
                target === undefined
                    ? snapshot.text
                    : (this.service.documents.get(target.uri)?.text ??
                      snapshot.text);

            return target === undefined ? null : location(target, targetText);
        }

        if (method === "textDocument/references") {
            return this.service.references(uri, offset).map((target) => {
                const targetText =
                    this.service.documents.get(target.uri)?.text ??
                    snapshot.text;

                return location(target, targetText);
            });
        }

        if (method === "textDocument/completion") {
            return this.service.completions(uri, offset).map((item) => {
                return {
                    label: item.label,
                    detail: item.detail,
                    ...(item.documentation === undefined
                        ? {}
                        : {
                              documentation: {
                                  kind: "markdown",
                                  value: item.documentation,
                              },
                          }),
                    kind:
                        item.kind === "function"
                            ? 3
                            : item.kind === "variable"
                              ? 6
                              : item.kind === "keyword"
                                ? 14
                                : 25,
                };
            });
        }

        if (method === "textDocument/signatureHelp") {
            const help = this.service.signatureHelp(uri, offset);

            return help === undefined
                ? null
                : {
                      signatures: [
                          {
                              label: help.label,
                              ...(help.documentation === undefined
                                  ? {}
                                  : {
                                        documentation: {
                                            kind: "markdown",
                                            value: help.documentation,
                                        },
                                    }),
                              parameters: help.parameters.map((label) => {
                                  return {
                                      label,
                                  };
                              }),
                          },
                      ],
                      activeSignature: 0,
                      activeParameter: help.activeParameter,
                  };
        }

        if (method === "textDocument/documentSymbol") {
            return this.service.documentSymbols(uri).map((symbol) => {
                return {
                    name: symbol.name,
                    kind:
                        symbol.kind === "function"
                            ? 12
                            : symbol.kind === "variable"
                              ? 13
                              : 14,
                    range: rangeAt(snapshot.text, symbol.range),
                    selectionRange: rangeAt(snapshot.text, symbol.range),
                };
            });
        }

        if (method === "textDocument/rename") {
            const rename = params as TextDocumentPosition & { newName: string };

            const edits = this.service.rename(uri, offset, rename.newName);

            const changes: Record<string, object[]> = {};

            for (const value of edits) {
                const targetText =
                    this.service.documents.get(value.uri)?.text ??
                    snapshot.text;

                changes[value.uri] ??= [];

                changes[value.uri]?.push(edit(value, targetText));
            }

            return {
                changes,
            };
        }

        if (method === "textDocument/prepareRename") {
            const range = this.service.prepareRename(uri, offset);

            return range === undefined ? null : rangeAt(snapshot.text, range);
        }

        if (method === "textDocument/foldingRange") {
            return this.service.foldingRanges(uri).map((fold) => {
                const range = rangeAt(snapshot.text, fold.range);

                return {
                    startLine: range.start.line,
                    startCharacter: range.start.character,
                    endLine: range.end.line,
                    endCharacter: range.end.character,
                    kind: "region",
                };
            });
        }

        if (method === "textDocument/selectionRange") {
            const values = params as {
                positions?: readonly Position[];
            };

            return (values.positions ?? []).map((position) => {
                const ranges = this.service.selectionRanges(
                    uri,
                    offsetAt(snapshot.text, position),
                );

                let parent: object | undefined;

                for (const range of ranges.toReversed()) {
                    parent = {
                        range: rangeAt(snapshot.text, range),
                        ...(parent === undefined ? {} : { parent }),
                    };
                }

                return parent;
            });
        }

        if (method === "textDocument/inlayHint") {
            const values = params as { range?: Range };

            const range =
                values.range === undefined
                    ? undefined
                    : {
                          start: offsetAt(snapshot.text, values.range.start),
                          end: offsetAt(snapshot.text, values.range.end),
                      };

            return this.service.inlayHints(uri, range).map((hint) => {
                return {
                    position: positionAt(snapshot.text, hint.position),
                    label: hint.label,
                    kind: 2,
                    paddingRight: true,
                };
            });
        }

        if (method === "textDocument/semanticTokens/full") {
            const kinds = [
                "comment",
                "function",
                "string",
                "number",
                "operator",
                "parameter",
                "variable",
            ];

            let previousLine = 0;

            let previousCharacter = 0;

            const data: number[] = [];

            for (const token of this.service.semanticTokens(uri)) {
                const start = positionAt(snapshot.text, token.range.start);

                const deltaLine = start.line - previousLine;

                const deltaCharacter =
                    deltaLine === 0
                        ? start.character - previousCharacter
                        : start.character;

                data.push(
                    deltaLine,
                    deltaCharacter,
                    token.range.end - token.range.start,
                    kinds.indexOf(token.type),
                    0,
                );

                previousLine = start.line;

                previousCharacter = start.character;
            }

            return { data };
        }

        if (
            method === "textDocument/formatting" ||
            method === "textDocument/rangeFormatting"
        ) {
            const values = params as {
                options?: { tabSize?: number; insertSpaces?: boolean };
                range?: Range;
            };

            const options = {
                indentStyle:
                    values.options?.insertSpaces === false
                        ? ("tab" as const)
                        : ("space" as const),
                indentWidth: values.options?.tabSize ?? 4,
            };

            const formatRange =
                values.range === undefined
                    ? undefined
                    : {
                          start: offsetAt(snapshot.text, values.range.start),
                          end: offsetAt(snapshot.text, values.range.end),
                      };

            return this.service
                .format(uri, options, formatRange)
                .map((value) => {
                    return edit(value, snapshot.text);
                });
        }

        if (method === "textDocument/codeAction") {
            return this.service.codeActions(uri).map((action) => {
                return {
                    title: action.title,
                    kind: action.kind,
                    diagnostics: [
                        {
                            message: action.diagnostic.message,
                            range: rangeAt(
                                snapshot.text,
                                action.diagnostic.range,
                            ),
                        },
                    ],
                    edit:
                        action.edit === undefined
                            ? undefined
                            : {
                                  changes: {
                                      [uri]: [edit(action.edit, snapshot.text)],
                                  },
                              },
                };
            });
        }

        return null;
    }

    publishDiagnostics(uri: string): object {
        const snapshot = this.service.documents.get(uri);

        if (snapshot === undefined) {
            return {
                jsonrpc: "2.0",
                method: "textDocument/publishDiagnostics",
                params: { uri, diagnostics: [] },
            };
        }

        const diagnostics = this.service.diagnostics(uri).map((diagnostic) => {
            return {
                range: rangeAt(snapshot.text, diagnostic.range),
                severity: diagnostic.severity === "error" ? 1 : 2,
                code: "code" in diagnostic ? diagnostic.code : diagnostic.rule,
                source: "wiz",
                message: diagnostic.message,
            };
        });

        return {
            jsonrpc: "2.0",
            method: "textDocument/publishDiagnostics",
            params: { uri, diagnostics },
        };
    }
}

interface RpcMessage {
    jsonrpc: "2.0";
    id?: string | number;
    method: string;
    params?: unknown;
}

function writeMessage(message: unknown): void {
    const body = JSON.stringify(message);

    const length = new TextEncoder().encode(body).byteLength;

    process.stdout.write(`Content-Length: ${length}\r\n\r\n${body}`);
}

function appendBytes(
    left: Uint8Array<ArrayBufferLike>,
    right: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBufferLike> {
    const result = new Uint8Array(left.byteLength + right.byteLength);

    result.set(left, 0);

    result.set(right, left.byteLength);

    return result;
}

function headerEnd(buffer: Uint8Array<ArrayBufferLike>): number {
    for (let index = 0; index <= buffer.byteLength - 4; index += 1) {
        if (
            buffer[index] === 13 &&
            buffer[index + 1] === 10 &&
            buffer[index + 2] === 13 &&
            buffer[index + 3] === 10
        ) {
            return index;
        }
    }

    return -1;
}

/** Serves Content-Length framed JSON-RPC until standard input closes. */
export async function serveStdio(server?: LspServer): Promise<void> {
    const activeServer = server ?? new LspServer();

    if (server === undefined) {
        await activeServer.reloadConfiguration();
    }

    const decoder = new TextDecoder();

    let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();

    for await (const chunk of Bun.stdin.stream()) {
        buffer = appendBytes(buffer, chunk);

        while (true) {
            const end = headerEnd(buffer);

            if (end < 0) {
                break;
            }

            const header = decoder.decode(buffer.slice(0, end));

            const lengthLine = header.split("\r\n").find((line) => {
                return line.toLowerCase().startsWith("content-length:");
            });

            const length = Number(
                lengthLine?.slice("content-length:".length).trim(),
            );

            const bodyStart = end + 4;

            if (
                !Number.isFinite(length) ||
                buffer.byteLength < bodyStart + length
            ) {
                break;
            }

            const body = decoder.decode(
                buffer.slice(bodyStart, bodyStart + length),
            );

            buffer = buffer.slice(bodyStart + length);

            const message = JSON.parse(body) as RpcMessage;

            if (message.id === undefined) {
                if (message.method === "exit") {
                    return;
                }

                activeServer.notify(message.method, message.params ?? null);

                if (
                    message.method === "workspace/didChangeConfiguration" ||
                    message.method === "workspace/didChangeWatchedFiles"
                ) {
                    await activeServer.reloadConfiguration();

                    for (const document of activeServer.service.documents.values()) {
                        writeMessage(
                            activeServer.publishDiagnostics(document.uri),
                        );
                    }
                }

                if (
                    message.method === "textDocument/didOpen" ||
                    message.method === "textDocument/didChange" ||
                    message.method === "textDocument/didClose"
                ) {
                    const uri = (
                        message.params as
                            | { textDocument?: { uri?: string } }
                            | undefined
                    )?.textDocument?.uri;

                    if (uri !== undefined) {
                        writeMessage(activeServer.publishDiagnostics(uri));
                    }
                }
            } else {
                try {
                    writeMessage({
                        jsonrpc: "2.0",
                        id: message.id,
                        result: activeServer.request(
                            message.method,
                            message.params ?? null,
                        ),
                    });
                } catch (err) {
                    writeMessage({
                        jsonrpc: "2.0",
                        id: message.id,
                        error: {
                            code: -32603,
                            message:
                                err instanceof Error
                                    ? err.message
                                    : String(err),
                        },
                    });
                }
            }
        }
    }
}
