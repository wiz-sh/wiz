---
title: "Syntax"
description: "Learn the shell-shaped grammar for typed declarations, signatures, calls, control flow, and declaration files."
---


Typed declarations extend the Bash `declare` and `local` builtins with `-T`:

```wiz
declare -rxT path CONFIG="/etc/example/config"
local -T int attempt=1
declare -T string[] services=("web" "db")
```

Wiz otherwise uses Bash assignments, commands, pipelines, lists, redirections, `if`, `case`,
loops, arithmetic, arrays, expansions, substitutions, process substitution, and heredocs.
Quotes are semantic and the formatter preserves their spelling.

Invalid: `let port: number = 8080;` and `serve("localhost")`. Use `declare -T int
port=8080` and `serve "localhost"`.
