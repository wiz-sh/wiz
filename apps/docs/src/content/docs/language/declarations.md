---
title: "Declarations"
description: "Declare typed globals, locals, readonly values, exports, collections, and positional boundaries with shell syntax."
---


```wiz
declare -T string name="Hazel"
declare -rT path config="/etc/example/config"
declare -xT int PORT=8080
local -T bool enabled=true
```

Attributes other than `T` retain Bash meaning and can be combined (`-rxT`). A positional
assertion such as `declare -T int "$1"` declares the type of parameter 1 and does not emit an
invalid Bash variable declaration. With boundary checks it becomes an assertion; with checks
disabled it is erased.

Collections use the same declaration form:

```wiz
declare -T string[] services=("caddy" "postgresql")
declare -T map<string, int> ports=([http]=80 [https]=443)
```

The Bash backend emits indexed and associative declaration attributes (`-a`
and `-A`) and checks literal element values before emission.

## Scoped modules

Plain `source "./helpers.wiz"` retains normal shell behavior. When a caller
needs an explicit module boundary, use the extended source option:

```wiz
source -I greeting greet -- "./helpers.wiz"
```

The module marks public variables and functions with Bash's existing export
commands:

```wiz
declare -T string greeting="Hello"

greet(string name): void {
    printf '%s, %s!\n' "$greeting" "$name"
}

export greeting
export -f greet
```

`-I` means *import*. The `--` delimiter separates imported names from the
module path. Wiz reports `WIZ3004` when a requested name is missing or private.
The Bash backend evaluates the module in an isolated subshell, forwards its
normal output, and copies only the selected declarations into the caller.
Scoped runtime imports currently require the Bash target; Zsh and portable
`sh` builds report an unsupported-target diagnostic instead of weakening the
scope boundary.
