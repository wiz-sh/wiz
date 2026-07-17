import { expect, test } from "bun:test";
import { LspServer } from "../src/index.ts";

test("protocol server initializes and serves document features", () => {
    const server = new LspServer();

    const uri = "file:///workspace/main.wiz";

    const text = "declare -T int port=8080\nprintf '%s\\n' \"$port\"\n";

    const initialized = server.request("initialize", {});

    server.notify("textDocument/didOpen", {
        textDocument: { uri, text, version: 1 },
    });

    const hover = server.request("textDocument/hover", {
        textDocument: { uri },
        position: { line: 1, character: 17 },
    });

    const completion = server.request("textDocument/completion", {
        textDocument: { uri },
        position: { line: 1, character: 0 },
    });

    const diagnostics = server.request("textDocument/diagnostic", {
        textDocument: { uri },
    });

    expect(initialized).toEqual(
        expect.objectContaining({
            capabilities: expect.objectContaining({ hoverProvider: true }),
        }),
    );

    expect(hover).toEqual(
        expect.objectContaining({
            contents: expect.objectContaining({
                value: expect.stringContaining("port: int"),
            }),
        }),
    );

    expect(completion).toBeArray();

    expect(diagnostics).toEqual(
        expect.objectContaining({ kind: "full", items: [] }),
    );
});

test("protocol exposes every advertised document intelligence feature", () => {
    const server = new LspServer();

    const uri = "file:///workspace/features.wiz";

    const text = `declare -T int port=8080

serve(string host): status {
printf '%s\\n' "$host"
}

serve $port
`;

    server.notify("textDocument/didOpen", {
        textDocument: { uri, text, version: 1 },
    });

    const document = { textDocument: { uri } };

    const callPosition = { line: 6, character: 2 };

    const references = server.request("textDocument/references", {
        ...document,
        position: callPosition,
        context: { includeDeclaration: true },
    });

    const signature = server.request("textDocument/signatureHelp", {
        ...document,
        position: { line: 6, character: 11 },
    });

    const symbols = server.request("textDocument/documentSymbol", document);

    const semanticTokens = server.request(
        "textDocument/semanticTokens/full",
        document,
    );

    const formatting = server.request("textDocument/formatting", {
        ...document,
        options: { tabSize: 4, insertSpaces: true },
    });

    const rangeFormatting = server.request("textDocument/rangeFormatting", {
        ...document,
        options: { tabSize: 4, insertSpaces: true },
        range: {
            start: { line: 3, character: 0 },
            end: { line: 4, character: 0 },
        },
    });

    const codeActions = server.request("textDocument/codeAction", {
        ...document,
        range: {
            start: { line: 6, character: 0 },
            end: { line: 6, character: 11 },
        },
        context: { diagnostics: [] },
    });

    expect(references).toBeArray();

    expect(references).toHaveLength(2);

    expect(signature).toEqual(
        expect.objectContaining({
            activeParameter: 0,
            signatures: [
                expect.objectContaining({
                    label: "serve(string host): status",
                }),
            ],
        }),
    );

    expect(symbols).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ name: "port" }),
            expect.objectContaining({ name: "serve" }),
        ]),
    );

    expect(semanticTokens).toEqual(
        expect.objectContaining({
            data: expect.any(Array),
        }),
    );

    expect((semanticTokens as { data: number[] }).data.length).toBeGreaterThan(
        0,
    );

    expect(formatting).toBeArray();

    expect(formatting).not.toHaveLength(0);

    expect(rangeFormatting).toBeArray();

    expect(rangeFormatting).not.toHaveLength(0);

    expect(codeActions).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                kind: "quickfix",
                title: "Fix safety/no-unquoted-expansion",
            }),
        ]),
    );

    server.notify("textDocument/didChange", {
        textDocument: { uri, version: 2 },
        contentChanges: [
            {
                text: text.replace("serve $port", 'serve "web"'),
            },
        ],
    });

    expect(server.request("textDocument/diagnostic", document)).toEqual({
        kind: "full",
        items: [],
    });
});

test("cross-file definitions use the target document coordinate space", () => {
    const server = new LspServer();

    const declarationUri = "file:///workspace/globals.wiz";

    const consumerUri = "file:///workspace/main.wiz";

    server.notify("textDocument/didOpen", {
        textDocument: {
            uri: declarationUri,
            text: "# heading\n# another heading\ndeclare -T int port=8080\nexport port\n",
            version: 1,
        },
    });

    server.notify("textDocument/didOpen", {
        textDocument: {
            uri: consumerUri,
            text: 'source -I port -- "./globals.wiz"\nprintf \'%s\\n\' "$port"\n',
            version: 1,
        },
    });

    const definition = server.request("textDocument/definition", {
        textDocument: { uri: consumerUri },
        position: { line: 1, character: 17 },
    });

    expect(definition).toEqual(
        expect.objectContaining({
            uri: declarationUri,
            range: expect.objectContaining({
                start: { line: 2, character: 0 },
            }),
        }),
    );
});

test("rename returns workspace edits grouped by target document", () => {
    const server = new LspServer();

    const declarationUri = "file:///workspace/helpers.wiz";

    const consumerUri = "file:///workspace/main.wiz";

    server.notify("textDocument/didOpen", {
        textDocument: {
            uri: declarationUri,
            text: "serve(string name): status {\n    return 0\n}\nexport -f serve\n",
            version: 1,
        },
    });

    server.notify("textDocument/didOpen", {
        textDocument: {
            uri: consumerUri,
            text: 'source -I serve -- "./helpers.wiz"\nserve "web"\n',
            version: 1,
        },
    });

    const rename = server.request("textDocument/rename", {
        textDocument: { uri: consumerUri },
        position: { line: 1, character: 2 },
        newName: "start",
    });

    expect(rename).toEqual({
        changes: {
            [declarationUri]: [
                {
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 5 },
                    },
                    newText: "start",
                },
                {
                    range: {
                        start: { line: 3, character: 10 },
                        end: { line: 3, character: 15 },
                    },
                    newText: "start",
                },
            ],
            [consumerUri]: [
                {
                    range: {
                        start: { line: 0, character: 10 },
                        end: { line: 0, character: 15 },
                    },
                    newText: "start",
                },
                {
                    range: {
                        start: { line: 1, character: 0 },
                        end: { line: 1, character: 5 },
                    },
                    newText: "start",
                },
            ],
        },
    });
});

test("incremental sync and structural editor requests preserve document state", () => {
    const server = new LspServer();

    const uri = "file:///workspace/incremental.wiz";

    const text = `serve(string host): status {
    printf '%s\\n' "$host"
}
serve "web"
`;

    const initialized = server.request("initialize", {}) as {
        capabilities: { textDocumentSync: number };
    };

    expect(initialized.capabilities.textDocumentSync).toBe(2);

    server.notify("textDocument/didOpen", {
        textDocument: { uri, text, version: 1 },
    });

    server.notify("textDocument/didChange", {
        textDocument: { uri, version: 2 },
        contentChanges: [
            {
                range: {
                    start: { line: 3, character: 6 },
                    end: { line: 3, character: 11 },
                },
                text: '"api"',
            },
        ],
    });

    expect(server.service.documents.get(uri)?.text).toContain('serve "api"');

    expect(
        server.request("textDocument/prepareRename", {
            textDocument: { uri },
            position: { line: 3, character: 2 },
        }),
    ).toEqual(
        expect.objectContaining({
            start: { line: 3, character: 0 },
            end: { line: 3, character: 5 },
        }),
    );

    expect(server.request("workspace/symbol", { query: "serve" })).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "serve" })]),
    );

    expect(
        server.request("textDocument/foldingRange", {
            textDocument: { uri },
        }),
    ).not.toHaveLength(0);

    expect(
        server.request("textDocument/inlayHint", {
            textDocument: { uri },
            range: {
                start: { line: 0, character: 0 },
                end: { line: 4, character: 0 },
            },
        }),
    ).toEqual(
        expect.arrayContaining([expect.objectContaining({ label: "host:" })]),
    );
});
