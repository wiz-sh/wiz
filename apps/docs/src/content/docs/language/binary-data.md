---
title: "Binary data"
description: "Preserve NUL bytes and arbitrary command output without placing binary data in shell variables."
---

Bash strings are terminated internally by byte `0x00`. No syntax extension can
make a Bash variable safely contain a NUL byte, and command substitution warns
and removes or changes those bytes. Wiz fixes the programming model instead of
pretending the host shell can represent binary strings.

## Opaque `bytes` values

A Wiz `bytes` value is an opaque handle to a temporary file. The shell variable
contains only the handle path; the payload stays byte-exact on disk. Wiz rejects
using the handle as ordinary text:

```wiz
bytes capture payload -- printf 'hello\0world'
printf '%s\n' "$payload"
```

```text
WIZ4005 Bytes value payload is opaque; use bytes emit, pipe, save, length, or dispose
```

Capture stdout directly, without `$()`:

```wiz
bytes capture payload -- some_binary_command --output -
bytes pipe "$payload" -- another_command --input -
bytes save "$payload" "./artifact.bin"
bytes dispose "$payload"
```

`capture` records the producer's exit status and preserves its output even when
the producer fails, allowing diagnostics or partial output to be inspected.
`read` makes an owned byte-exact copy of a file. `emit` writes bytes to stdout,
`pipe` provides them as a command's stdin, `save` copies them to a durable path,
and `length` prints the byte count. `dispose` deletes the temporary payload.

## NUL-delimited records

When NUL is a separator rather than payload, streaming remains the simplest
approach:

```wiz
find . -type f -print0 | while IFS= read -r -d '' file; do
    printf 'File: %q\n' "$file"
done
```

To retain and replay the stream, capture it first:

```wiz
bytes capture files -- find . -type f -print0
bytes pipe "$files" -- xargs -0 -n 1 printf '%s\n'
bytes dispose "$files"
```

Encoding remains useful when binary data must cross a text-only boundary such
as JSON or an environment variable. Encode before substitution and decode into
a stream, file, or `bytes` value rather than a shell variable.
