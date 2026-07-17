import { expect, test } from "bun:test";
import { join } from "node:path";

interface ResponseMessage {
    id?: number;
    method?: string;
    result?: unknown;
}

function frame(message: unknown): Uint8Array {
    const body = JSON.stringify(message);

    const encoded = new TextEncoder().encode(body);

    const header = new TextEncoder().encode(
        `Content-Length: ${encoded.byteLength}\r\n\r\n`,
    );

    const result = new Uint8Array(header.byteLength + encoded.byteLength);

    result.set(header, 0);

    result.set(encoded, header.byteLength);

    return result;
}

function responses(buffer: Uint8Array): ResponseMessage[] {
    const decoder = new TextDecoder();

    const result: ResponseMessage[] = [];

    const text = decoder.decode(buffer);

    let offset = 0;

    while (offset < text.length) {
        const end = text.indexOf("\r\n\r\n", offset);

        if (end < 0) {
            throw new Error(
                `Incomplete LSP response header: ${JSON.stringify(text.slice(offset))}`,
            );
        }

        const header = text.slice(offset, end);

        const length = Number(
            /Content-Length:\s*(\d+)/i.exec(header)?.[1] ?? "",
        );

        const bodyStart = end + 4;

        const bodyEnd = bodyStart + length;

        result.push(
            JSON.parse(text.slice(bodyStart, bodyEnd)) as ResponseMessage,
        );

        offset = bodyEnd;
    }

    return result;
}

test("stdio JSON-RPC handles Unicode byte lengths and exits cleanly", async () => {
    const processHandle = Bun.spawn(
        ["bun", join(import.meta.dir, "../src/index.ts")],
        {
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
        },
    );

    const messages = [
        {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { clientInfo: { name: "éditeur 🌱" } },
        },
        {
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
                textDocument: {
                    uri: "file:///workspace/unicode.wiz",
                    text: "# café 🌱\ndeclare -T int port=8080\n",
                    version: 1,
                },
            },
        },
        {
            jsonrpc: "2.0",
            id: 2,
            method: "textDocument/hover",
            params: {
                textDocument: {
                    uri: "file:///workspace/unicode.wiz",
                },
                position: { line: 1, character: 17 },
            },
        },
        {
            jsonrpc: "2.0",
            id: 3,
            method: "shutdown",
            params: null,
        },
        {
            jsonrpc: "2.0",
            method: "exit",
            params: null,
        },
    ];

    for (const message of messages) {
        processHandle.stdin.write(frame(message));
    }

    processHandle.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(processHandle.stdout).bytes(),
        new Response(processHandle.stderr).text(),
        processHandle.exited,
    ]);

    const parsed = responses(stdout);

    expect(exitCode).toBe(0);

    expect(stderr).toBe("");

    expect(
        parsed.find((message) => {
            return message.id === 1;
        })?.result,
    ).toBeDefined();

    expect(
        parsed.find((message) => {
            return message.id === 2;
        })?.result,
    ).toEqual(
        expect.objectContaining({
            contents: expect.objectContaining({
                value: expect.stringContaining("port: int"),
            }),
        }),
    );

    expect(
        parsed.find((message) => {
            return message.id === 3;
        })?.result,
    ).toBeNull();

    expect(
        parsed.some((message) => {
            return message.method === "textDocument/publishDiagnostics";
        }),
    ).toBe(true);
});
