---
title: "Diagnostics"
description: "Design stable compiler, configuration, and linter diagnostics with precise ranges and actionable messages."
---


Compiler codes are stable by phase: `Wiz1xxx` lexer, `Wiz2xxx` parser, `Wiz3xxx` binding,
`Wiz4xxx` type checking, and `Wiz5xxx` project/emission. Configuration uses `WIZCFGxxx`.

Example:

```text
src/main.wiz:12:14 WIZ4001 Argument 1 of start_server expects string, but received int
```

Diagnostics contain source filename, half-open offset range, severity, phase, code, and message.
The language service deduplicates reports by file/range/code before translating them to LSP.

The initial lexer recovery codes are:

| Code | Meaning |
| --- | --- |
| `WIZ1001` | A single- or double-quoted token is unfinished. |
| `WIZ1002` | A parameter, command, or arithmetic expansion is unfinished. |
| `WIZ1003` | A heredoc terminator is missing. |

Recovery diagnostics do not discard source text. The lossless tree retains the
incomplete token or heredoc body so formatting, highlighting, and subsequent
edits continue to work in the editor.
