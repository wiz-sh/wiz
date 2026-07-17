---
title: "Language server"
description: "Run and integrate the Wiz language server for diagnostics, navigation, IntelliSense, formatting, and code actions."
---


Run `wiz c lsp --stdio`. The server implements initialize, open/change/close, combined
diagnostics, hover, definition, references, completion, signature help, document symbols,
rename, semantic tokens, document/range formatting, and code actions. It uses `Content-Length`
JSON-RPC framing and exits when stdin closes.

Clients should identify both `.wiz` and `.d.wiz` as `wiz` and resend workspace configuration
when `config.wiz.json` changes.

The transport counts UTF-8 bytes, so non-ASCII source and client names do not
desynchronize framing. Shutdown and `exit` are handled without leaving the
server process behind. A configuration file change reloads formatter and linter
settings, then republishes diagnostics for every open document.

```text
Content-Length: 58\r\n
\r\n
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
```

The LSP package is transport-only: cross-file rename, symbol ownership,
signature help, and quick-fix generation remain in `@wiz/language-service`.
Completions and signature help include the bundled shell, coreutils, Git, curl,
Docker, systemctl, jq, SSH, and related ambient command declarations.
