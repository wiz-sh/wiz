import { expect, test } from "bun:test";
import { LspServer } from "../src/index.ts";

test("closing a document clears diagnostics and snapshots", () => {
    const server = new LspServer();

    const uri = "file:///workspace/main.wiz";

    server.notify("textDocument/didOpen", {
        textDocument: {
            uri,
            text: "printf '%s\\n' $missing\n",
            version: 1,
        },
    });

    expect(server.service.documents.get(uri)).toBeDefined();

    server.notify("textDocument/didClose", {
        textDocument: { uri },
    });

    expect(server.service.documents.get(uri)).toBeUndefined();

    expect(server.publishDiagnostics(uri)).toEqual(
        expect.objectContaining({
            params: { uri, diagnostics: [] },
        }),
    );
});
