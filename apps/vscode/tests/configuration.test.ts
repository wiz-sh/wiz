import { expect, test } from "bun:test";
import configuration from "../syntaxes/language-configuration.json";

test("language configuration supports shell comments and balanced delimiters", () => {
    expect(configuration.comments.lineComment).toBe("#");

    expect(configuration.brackets).toContainEqual(["{", "}"]);

    expect(configuration.brackets).toContainEqual(["(", ")"]);
});

test("the extension watches sourced shell files for IntelliSense refresh", async () => {
    const client = await Bun.file(
        new URL("../src/language-client.ts", import.meta.url),
    ).text();

    expect(client).toContain('createFileSystemWatcher("**/*.{wiz,sh,zsh}")');

    expect(client).toContain('args: ["c", "lsp", "--stdio"]');
});
