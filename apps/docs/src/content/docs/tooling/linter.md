---
title: "Linter"
description: "Configure correctness, safety, suspicious, and style rules with precisely classified safe and unsafe fixes."
---


Rules use compiler syntax, scopes, and inferred types. Categories are `correctness`, `safety`,
`suspicious`, and `style`; names such as `safety/no-eval` are stable configuration keys.

```json
{ "linter": { "rules": { "safety/no-unquoted-expansion": "error", "style/prefer-typed-parameters": "off" } } }
```

`wiz lint --fix .` applies only fixes marked safe. `--fix-unsafe` also enables behavioral
rewrites. Diagnostics include the exact range, configured severity, explanation, and fix safety.
