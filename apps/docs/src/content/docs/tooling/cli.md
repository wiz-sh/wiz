---
title: "CLI reference"
description: "Reference every Wiz package, runtime, workspace, and Wiz command with its important options and behavior."
---


```console
wiz src/main.wiz -- arg1 arg2
wiz check [src/main.wiz] [--target bash|zsh|sh|fish|powershell|cmd]
wiz watch src/main.wiz -- arg1 arg2
wiz c init
wiz c build [src/main.wiz] [--target bash|zsh|sh|fish|powershell|cmd] [--bundle] [--minify]
wiz c check [src/main.wiz] [--target bash|zsh|sh|fish|powershell|cmd]
wiz c run src/main.wiz -- arg1 arg2
wiz c watch
wiz format --check .
wiz lint --fix .
wiz c lsp --stdio
wiz c config
wiz c map dist/main.sh:20
```

`wiz file.wiz` is the shortest compile-and-run form. `wiz run file.wiz` is
equivalent, while `wiz run` continues to execute ordinary shell files and
package binaries. `wiz check` performs parsing, binding, and static type
checking without emitting output. `wiz watch` rebuilds on dependency changes
and restarts the entry program only after a successful build.

Build accepts `.wiz`, `.sh`, and `.zsh` inputs. Bash remains the default target.
An explicit target overrides `compiler.target` for that invocation:

```console
wiz c build src/main.wiz --target zsh
wiz c build src/portable.zsh --target sh
wiz c build src/main.wiz --target fish
wiz c build src/main.wiz --target powershell
```

The compiler rejects target-specific syntax that cannot be translated safely.
It does not pretend that every arbitrary Bash or Zsh program is portable.

`--bundle` inlines statically resolved `.wiz` and `.sh` source dependencies into entry outputs.
`--minify` removes comments and redundant layout while preserving shell command boundaries,
quotes, and heredoc bodies. Both options also have `compiler.bundle` and `compiler.minify`
configuration equivalents.

`wiz format` and its shorter `wiz fmt` alias are top-level commands, as is `wiz lint`.
The older `wiz c format` and `wiz c lint` spellings remain compatibility aliases.

Existing package commands and aliases remain: `init`, `install`/`i`, `update`, `run`, `script`,
`x`, `dlx`, `index`, `resolve`, `list`, `info`, `remove`/`rm`, `link`, `unlink`, `clean`,
`prune`, `approve`, and `bin`. `wiz root` prints the containing project and `wiz needs curl`
fails with a clear error when a required executable is absent.

## Monorepo commands

```console
wiz init suite --monorepo
wiz workspace list
wiz workspace root
wiz workspace add shared
wiz install --workspace shared
wiz workspace run check --if-present -- --verbose
wiz workspace list --json
```

`workspace add` and `install --workspace` are equivalent. They add an explicit
`{ "workspace": "*" }` dependency to the nearest package, resolve the complete
local and Git graph, write a portable lockfile, and create live links. A frozen
install verifies that workspace paths still match root declarations.

At a monorepo root, plain `wiz install` installs every matched package.
`workspace run` uses deterministic package-name order, forwards arguments after
`--`, and returns the failing script's exit code. `--if-present` skips packages
that do not define the script.
