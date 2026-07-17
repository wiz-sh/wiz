---
title: "VS Code extension"
description: "Install and configure production-grade Wiz highlighting, IntelliSense, diagnostics, formatting, and project commands."
---

The extension in `apps/vscode` registers language id `wiz`, `.wiz` and `.d.wiz`,
a shell-document file icon, TextMate highlighting, semantic highlighting,
comments, brackets, indentation, folding, snippets, and `wiz c lsp --stdio`.
Set `wiz.server.path` if `wiz` is not on `PATH`.

Command Palette entries restart the server, format the document, lint and fix
the active file, build, and check. A status-bar item reports the language-server
lifecycle and restarts it when clicked. Compiler and lint semantics stay in
workspace packages rather than the extension.

The extension contributes itself as the default formatter for Wiz and enables
format-on-save. Repository contributors also receive the Biome recommendation
and save actions for TypeScript, JavaScript, and JSON through `.vscode`:

```json
{
    "[wiz]": {
        "editor.defaultFormatter": "wiz.wiz-language",
        "editor.formatOnSave": true
    }
}
```

Paths passed by the lint command are shell-quoted before entering the integrated
terminal. Set `wiz.server.path` to an absolute Wiz executable when the extension
host does not inherit your interactive shell `PATH`.

The client watches `.wiz`, `.sh`, and `.zsh` project files. A literal source such
as `source "./helpers.wiz"` provides IntelliSense and navigation immediately;
the helper does not need to be opened in an editor tab first.

## Troubleshooting

Set `wiz.server.trace` to `messages` or `verbose` to inspect protocol traffic in
the Wiz language-server output channel. If the status item reports a startup
error, set `wiz.server.path` to an absolute executable and run **Wiz: Restart
Language Server**. Wiz commands are disabled in untrusted workspaces because
build and lint actions intentionally execute project shell code.
