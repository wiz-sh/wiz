---
title: "Types"
description: "Use Wiz primitive, optional, array, map, boundary, any, unknown, and function result types."
---


Scalar types are `string`, `int`, `bool`, `path`, `file`, `directory`, `bytes`, `status`, `stream`,
`void`, `any`, `unknown`, and `never`. Collections initially include `string[]`, `int[]`,
`bool[]`, `map<string, string>`, and `map<string, int>`. A suffix `?` makes a value optional.

Arithmetic requires numeric-compatible input. A literal `42` is `int`; quoted text is
`string`; command substitution is `string` unless declarations say otherwise. In strict mode,
unsafe external values are `unknown` until narrowed. For example, passing `42` to `string host`
reports `WIZ4001 Argument 1 of serve expects string, but received int`.

```wiz
declare -T int attempts=1
attempts="many"
```

```text
src/main.wiz:2:1 WIZ4001 Cannot assign string to int attempts
```

With `strict: true`, an untyped assignment is `unknown`; it can be interpolated
as text but cannot be used in arithmetic or passed into a typed parameter until
checked. With strict mode disabled it becomes `any`. `implicitAny: false`
rejects that inference, and `allowAny: false` rejects an explicit `-T any`.

`bytes` is intentionally not assignable to `string`. It represents opaque,
file-backed binary data so NUL bytes never enter a shell variable. Use the
`bytes` operations described in [Binary data](/language/binary-data/) to capture,
pipe, save, or emit the payload.
