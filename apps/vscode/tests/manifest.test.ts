import { expect, test } from "bun:test";
import manifest from "../package.json";

test("extension registers Wiz files, LSP activation and commands", () => {
    expect(manifest.name).toBe("wiz-language");

    expect(manifest.activationEvents).toContain("onLanguage:wiz");

    expect(manifest.activationEvents).toContain(
        "workspaceContains:config.wiz.json",
    );

    expect(manifest.contributes.languages[0]?.extensions).toEqual([
        ".wiz",
        ".d.wiz",
    ]);

    expect(manifest.contributes.languages[0]?.icon).toEqual({
        light: "./media/wiz-light.svg",
        dark: "./media/wiz-dark.svg",
    });

    expect(manifest.contributes.snippets).toContainEqual({
        language: "wiz",
        path: "./syntaxes/wiz.code-snippets.json",
    });

    expect(manifest.contributes.semanticTokenScopes[0]?.scopes).toEqual(
        expect.objectContaining({
            function: ["entity.name.function.wiz"],
            parameter: ["variable.parameter.wiz"],
        }),
    );

    expect(
        manifest.contributes.commands.map((command) => {
            return command.command;
        }),
    ).toEqual([
        "wiz.restartLanguageServer",
        "wiz.formatDocument",
        "wiz.lintFix",
        "wiz.build",
        "wiz.check",
    ]);

    expect(manifest.contributes.configurationDefaults["[wiz]"]).toEqual(
        expect.objectContaining({
            "editor.defaultFormatter": "wiz.wiz-language",
            "editor.formatOnSave": true,
            "editor.semanticHighlighting.enabled": true,
        }),
    );

    expect(manifest.contributes.configuration.properties).toEqual(
        expect.objectContaining({
            "wiz.server.path": expect.any(Object),
            "wiz.server.trace": expect.any(Object),
            "wiz.commands.revealTerminal": expect.any(Object),
        }),
    );
});
