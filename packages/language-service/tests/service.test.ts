import { expect, test } from "bun:test";
import { LanguageService } from "../src/index.ts";

const uri = "file:///workspace/main.wiz";
const source = `declare -T int port=8080
start_server(string host, path root="/opt"): status {
    printf '%s:%s %s\\n' "$host" "$port" "$root"
}
start_server "localhost"
`;

test("language intelligence provides hover, definition, completion and signature help", () => {
    const service = new LanguageService();

    service.updateDocument(uri, source, 1);

    const call = source.lastIndexOf("start_server") + 2;

    const port = source.indexOf("$port") + 2;

    expect(service.diagnostics(uri)).toEqual([]);

    expect(service.hover(uri, call)?.contents).toContain(
        'start_server(string host, path root="/opt"): status',
    );

    expect(service.definition(uri, call)?.range.start).toBe(
        source.indexOf("start_server"),
    );

    expect(service.definition(uri, port)?.range.start).toBe(0);

    expect(
        service.completions(uri).map((item) => {
            return item.label;
        }),
    ).toContain("start_server");

    expect(service.signatureHelp(uri, source.length - 2)?.activeParameter).toBe(
        0,
    );

    expect(service.semanticTokens(uri)).toContainEqual(
        expect.objectContaining({
            type: "variable",
            range: {
                start: source.indexOf("port"),
                end: source.indexOf("port") + 4,
            },
        }),
    );
});

test("closing a project document removes its symbols from shared scopes", () => {
    const service = new LanguageService();

    const declarations = "file:///workspace/globals.wiz";

    const consumer = "file:///workspace/consumer.wiz";

    service.updateDocument(
        declarations,
        "declare -T int port=8080\nexport port\n",
        1,
    );

    service.updateDocument(
        consumer,
        'source -I port -- "./globals.wiz"\nprintf \'%s\\n\' "$port"\n',
        1,
    );

    expect(service.diagnostics(consumer)).toEqual([]);

    service.closeDocument(declarations);

    expect(service.diagnostics(consumer)).toContainEqual(
        expect.objectContaining({
            rule: "correctness/no-undefined-variable",
        }),
    );
});

test("declaration files provide external command signature help", () => {
    const service = new LanguageService();

    const declarations = "file:///workspace/commands.d.wiz";

    const consumer = "file:///workspace/main.wiz";

    service.updateDocument(
        declarations,
        `declare command service {
    restart(name: string, attempts: int): status
}
`,
        1,
    );

    const source = 'service restart "web" 2\n';

    service.updateDocument(consumer, source, 1);

    expect(service.signatureHelp(consumer, source.length - 1)).toEqual({
        label: "service restart(name: string, attempts: int): status",
        parameters: ["name: string", "attempts: int"],
        activeParameter: 1,
    });
});

test("bundled shell libraries power command IntelliSense", () => {
    const service = new LanguageService();

    const source = "printf '%s' ";

    service.updateDocument(uri, source, 1);

    expect(service.completions(uri)).toContainEqual(
        expect.objectContaining({
            label: "printf",
            detail: "status",
            kind: "function",
            documentation: expect.stringContaining("Writes formatted values"),
        }),
    );

    expect(service.signatureHelp(uri, source.length)).toEqual(
        expect.objectContaining({
            label: "printf(format: string, ...values: unknown[]): status",
            parameters: ["format: string", "...values: unknown[]"],
            activeParameter: 1,
            documentation: expect.stringContaining("Writes formatted values"),
        }),
    );
});

test("byte handles provide typed hover and operation signature help", () => {
    const service = new LanguageService();

    const binarySource = `bytes capture payload -- printf 'a\\0b'
bytes emit "$payload"
`;

    service.updateDocument(uri, binarySource, 1);

    const payload = binarySource.lastIndexOf("payload") + 2;

    expect(service.diagnostics(uri)).toEqual([]);

    expect(service.hover(uri, payload)?.contents).toContain("payload: bytes");

    expect(service.signatureHelp(uri, binarySource.length - 1)).toEqual(
        expect.objectContaining({
            label: "bytes emit(value: bytes): stream",
            parameters: ["value: bytes"],
        }),
    );
});

test("declaration semantic tokens override ambiguous builtin names", () => {
    const service = new LanguageService();

    const declarationUri = "file:///workspace/shell.d.wiz";

    const source =
        "declare command command(...arguments: any[]): status\n" +
        "declare command read(...arguments: any[]): status\n";

    service.updateDocument(declarationUri, source, 1);

    const tokens = service.semanticTokens(declarationUri);

    const declaredCommand = source.indexOf("command", "declare command".length);

    expect(tokens).toContainEqual({
        range: {
            start: declaredCommand,
            end: declaredCommand + "command".length,
        },
        type: "function",
    });

    for (let index = 1; index < tokens.length; index += 1) {
        const previous = tokens[index - 1];

        const current = tokens[index];

        expect(previous?.range.end).toBeLessThanOrEqual(
            current?.range.start ?? 0,
        );
    }
});

test("command schemas provide contextual option and subcommand completion", () => {
    const service = new LanguageService();

    const source = `declare command search {
    option -g, --glob <pattern: string> repeatable
    run(query: string): stream
}
search --
`;

    service.updateDocument(uri, source, 1);

    expect(service.completions(uri, source.length - 1)).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                label: "--glob",
                detail: "pattern: string",
            }),
            expect.objectContaining({ label: "run" }),
        ]),
    );
});
