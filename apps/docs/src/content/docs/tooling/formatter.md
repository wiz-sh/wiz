---
title: "Formatter"
description: "Format complete files or ranges deterministically while preserving shell quoting, comments, heredocs, and meaning."
---


The formatter consumes lossless compiler tokens, not a second parser. It reindents block
structure, removes trailing horizontal whitespace, retains comments and quote spelling, and
passes heredoc bodies through unchanged. It supports whole documents and ranges.

`wiz format --write .` edits files. `--check` reports drift and exits nonzero. For editor
or pipelines, `--stdin-file-path src/main.wiz` reads stdin and writes formatted source to stdout.
The invariant `format(format(source)) === format(source)` is tested for every fixture.

## Minification

`wiz fmt --minify --write src/main.wiz` produces compact source. For compiler output, prefer
`wiz c build --minify`; it runs after typed syntax is lowered. The minifier consumes lossless
tokens, removes comments and blank lines, collapses horizontal whitespace, and keeps one command
boundary per line. This deliberately avoids the fragile semicolon rewriting used by purely
textual shell minifiers. Heredoc bodies remain byte-for-byte intact.

Before:

```wiz
if true; then
printf '%s\n' "$HOME"   
fi
```

After:

```wiz
if true; then
    printf '%s\n' "$HOME"
fi
```

Range formatting calculates nesting from lines before the requested range but
does not rewrite those lines or change the file's trailing newline. Heredoc
bodies bypass indentation because their leading bytes may be data.
