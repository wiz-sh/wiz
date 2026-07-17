---
title: "Declaration files"
description: "Describe external commands, environments, sourced shell libraries, and package APIs without emitting runtime code."
---


`.d.wiz` files provide types and emit no Bash:

```wiz
declare command systemctl {
    restart(service: string): status
}
declare env HOME: path
declare env PORT?: int
```

Direct command declarations describe tools without subcommands:

```wiz
declare command deploy(destination: path, ...arguments: string[]): status
```

Wiz includes Bash, GNU/BSD core utility, and Wiz CLI declarations by default.
Other command surfaces are split into official packages under `@types/*`, so a
project does not pay for APIs it never uses:

```console
wiz install @types/python
wiz install @types/common
```

Import the aggregate or one focused declaration module with Bash-shaped,
compile-time-only syntax:

```wiz
source -T "@types/python"
source -T "@types/python/uv"
source -T "@types/common/git"
```

`source -T` is erased during emission. It contributes declarations to checking,
hover, completion, definition navigation, and signature help. A missing package
is a `WIZ5002` diagnostic instead of a runtime surprise.

Official packages include `@types/common`, `@types/db`, `@types/disk`,
`@types/js`, `@types/network`, `@types/system`, `@types/cloud`,
`@types/developer`, `@types/compilers`, `@types/python`, `@types/nix`,
`@types/github`, `@types/agents`, and `@types/security`. Their subpaths keep
Git, PostgreSQL, uv, Rust, Nix, `gh`, Codex, Claude Code, GPG, OpenSSL, DNS,
Nmap, and socket command surfaces opt-in.

```wiz
source -T "@types/network/dns"
source -T "@types/network/scanning"
source -T "@types/network/sockets"
source -T "@types/security/gpg"
source -T "@types/security/openssl"
source -T "@types/common/text"
source -T "@types/system/accounts"
```

These declarations enumerate command modes and supported options with literal
unions instead of falling back to `any`. Hover and signature help therefore
show concrete option contracts at the call site.

`@types/common/text` includes grep, ripgrep (`rg`), fd, fzf, bat, less,
tree, awk, sed, and jq. `@types/system/accounts` covers adduser, useradd,
usermod, userdel, group administration, passwords, and getent. For example,
completion after `rg --` offers real ripgrep flags and an unknown flag produces
`WIZ4001`.

Shell builtins are target-specific ambient declarations. Bash, Zsh, and `sh`
therefore expose their native `alias`, `export`, `set`, `readonly`, `local`,
`declare`, and `typeset` forms without installing another package.

When `source "./legacy.sh"` is encountered, the project resolver looks for
`legacy.d.wiz`. A literal `.wiz` source is parsed, bound, checked, added to the dependency graph,
emitted beside its importer, and rewritten to the selected target suffix.
