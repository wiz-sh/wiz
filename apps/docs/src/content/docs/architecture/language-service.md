---
title: "Language-service architecture"
description: "Understand project snapshots, editor intelligence, sourced-file graphs, and the thin LSP transport boundary."
---


`@wiz/language-service` owns open document snapshots and reusable editor features. Updating a
document reparses it, rebuilds shared project scopes, checks calls and assignments, and runs
configured lint rules. Hover, definitions, references, completion, signature help, rename,
symbols, semantic tokens, formatting edits, and quick fixes operate on that snapshot.

Bundled Bash, coreutils, and common-CLI `.d.wiz` files are bound as the parent of
the project scope. This gives every snapshot command completions and signatures
while allowing local declarations to refine the ambient APIs.

Literal `source` dependencies are discovered recursively from disk even when
the editor has never opened them. Dependencies bind before their importers, so
hover, completion, definition, references, signature help, and call checking
share one project scope. Open editor buffers take precedence over disk content,
and shell-file watcher events rebuild disk-backed snapshots after external
changes.

`@wiz/lsp` only translates offsets and protocol objects. It does not duplicate semantic rules.
The VS Code extension launches `wiz c lsp --stdio`, watches `config.wiz.json`, and registers
commands; no compiler code is bundled into extension handlers.
