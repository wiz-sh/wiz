import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { compileSource, parseSourceFile } from "../src/index.ts";

const source = `#!/usr/bin/env bash

declare -T int port=8080

start_server(
    string host,
    path root="/opt/server"
): status {
    printf 'Starting on %s:%s using %s\\n' "$host" "$port" "$root"
}

start_server "127.0.0.1"
`;

test("initial vertical slice parses, checks, emits, maps and executes", async () => {
    const root = join(import.meta.dir, ".tmp-vertical");

    const fileName = join(root, "main.wiz");

    const result = compileSource(source, fileName, {
        rootDir: root,
        outDir: join(root, "dist"),
        sourceMap: true,
        runtimeChecks: "boundaries",
    });

    const emitted = result.files[0];

    expect(result.diagnostics).toEqual([]);

    expect(emitted).toBeDefined();

    expect(emitted?.code).toContain("port=8080");

    expect(emitted?.code).toContain('local host="$1"');

    // This is Bash parameter syntax, not a JavaScript template placeholder.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the assertion must remain literal Bash.
    expect(emitted?.code).toContain('local root="${2:-/opt/server}"');

    expect(emitted?.map?.mappings.length).toBeGreaterThan(0);

    const syntax = Bun.spawnSync(["bash", "-n"], {
        stdin: new Blob([emitted?.code ?? ""]),
    });

    expect(syntax.exitCode).toBe(0);

    const execution = Bun.spawnSync(["bash"], {
        stdin: new Blob([emitted?.code ?? ""]),
    });

    expect(execution.exitCode).toBe(0);

    expect(execution.stdout.toString()).toBe(
        "Starting on 127.0.0.1:8080 using /opt/server\n",
    );

    await rm(root, { recursive: true, force: true });
});

test("typed function calls reject incompatible arguments", () => {
    const invalid = source.replace(
        'start_server "127.0.0.1"',
        "start_server 42",
    );

    const result = compileSource(invalid, "/tmp/invalid.wiz");

    expect(result.emitSkipped).toBe(true);

    expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
            code: "WIZ4001",
            message:
                "Argument 1 of start_server expects string, but received int",
        }),
    );
});

test("syntax tree is lossless", () => {
    const file = parseSourceFile(source, "main.wiz");

    expect(
        file.syntaxTree.tokens
            .map((token) => {
                return token.text;
            })
            .join(""),
    ).toBe(source);
});
