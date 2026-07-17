---
title: "Expansions"
description: "Use parameter, command, arithmetic, and process expansion while preserving quoting and type safety."
---


Wiz supports Bash parameter expansion, command substitution, arithmetic expansion, arrays,
and process substitution. Scalar interpolation converts values to text:

```wiz
declare -T int port=8080
printf 'port=%s\n' "$port"
declare -T string host="$(hostname)"
((port += 1))
```

Quotes still control splitting and globbing. `"${items[@]}"` preserves array elements;
unquoted `$value` produces `safety/no-unquoted-expansion` with a safe quoting fix.
