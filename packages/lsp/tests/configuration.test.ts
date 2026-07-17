import { afterEach, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { temporaryDirectory } from "../../../tests/utils/filesystem.ts";
import { LspServer } from "../src/index.ts";

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

test("LSP reloads formatter and linter project configuration", async () => {
    const root = await temporaryDirectory("wiz-lsp-config-");

    roots.push(root);

    await writeFile(
        join(root, "config.wiz.json"),
        JSON.stringify({
            formatter: {
                indentWidth: 2,
            },
            linter: {
                rules: {
                    "safety/no-eval": "off",
                },
            },
        }),
    );

    const server = new LspServer();

    await server.reloadConfiguration(root);

    const uri = "file:///workspace/main.wiz";

    server.service.updateDocument(
        uri,
        "if true; then\neval dangerous\nfi\n",
        1,
    );

    expect(server.service.format(uri)[0]?.newText).toContain(
        "  eval dangerous",
    );

    expect(
        server.service.diagnostics(uri).some((diagnostic) => {
            return "rule" in diagnostic && diagnostic.rule === "safety/no-eval";
        }),
    ).toBe(false);
});

test("configuration diagnostics participate in LSP diagnostics", async () => {
    const root = await temporaryDirectory("wiz-lsp-invalid-config-");

    roots.push(root);

    await mkdir(join(root, "src"));

    await writeFile(
        join(root, "config.wiz.json"),
        JSON.stringify({
            formatter: {
                indentWidth: 0,
            },
        }),
    );

    const server = new LspServer();

    await server.reloadConfiguration(root);

    const uri = "file:///workspace/main.wiz";

    server.service.updateDocument(uri, "printf ok\n", 1);

    expect(server.service.diagnostics(uri)).toContainEqual(
        expect.objectContaining({
            code: "WIZCFG003",
            message: expect.stringContaining("formatter.indentWidth"),
        }),
    );
});
