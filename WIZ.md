# Wiz for coding agents

Wiz is a typed shell language with an integrated multi-source package manager and
command runtime. Use this file when operating a Wiz project; use `AGENTS.md`
when modifying Wiz itself.

## Recognizing a project

A Wiz package contains `manifest.json`. `wiz root` prints its containing project
root even when invoked from `src`, `dist`, or another nested directory.
`config.wiz.json` configures Wiz. A monorepo root declares `workspaces` in its
manifest and can contain packages under patterns such as `packages/*`.

Manifest metadata is package-style and top-level: `name`, optional `version`,
`main`, `scripts`, `bin`, `dependencies`, and `workspaces`. New manifests carry
the Wiz JSON Schema. Do not add `manifestVersion` or a nested `package` object;
those fields are accepted only when reading older projects.

Create a package with:

```console
wiz init my-tool
```

This creates `manifest.json`, `config.wiz.json`, `.gitignore`, and executable
`src/index.sh` without replacing existing source or configuration. Use
`wiz init my-suite --monorepo` for a workspace root.

## Package and command operations

```console
wiz install https://github.com/example/logger.git
wiz install --workspace shared
wiz workspace list
wiz workspace run check --if-present
wiz resolve logger
wiz script test -- --verbose
wiz x formatter -- src/index.sh
wiz dlx https://github.com/example/tool.git -- --help
wiz needs curl
```

Dependencies may come from registries, Git repositories, local paths, or live
workspace links. Do not hand-edit
`wiz.lock.json`; let Wiz keep commit identities and workspace paths consistent.
`wiz needs <binary>` exits unsuccessfully with a useful requirement message when
the executable cannot be resolved.

## Wiz source

`.wiz` files are executable typed shell. `.d.wiz` files are declarations only.
Invocation always remains ordinary shell syntax:

```wiz
declare -T int port=8080

serve(string host, path root="/srv/app"): status {
    printf 'Serving %s:%s from %s\n' "$host" "$port" "$root"
}

serve "127.0.0.1"
```

Build and check a project with:

```console
wiz check
wiz c build
wiz src/main.wiz -- argument
wiz watch src/main.wiz
wiz format --check .
wiz lint .
```

Use scoped sourcing when a module should expose only a deliberate API:

```wiz
source -I greeting greet -- "./helpers.wiz"
```

The module publishes variables with `export greeting` and functions with
`export -f greet`. Plain `source` remains available when Bash's shared scope is
intentional.

Bash is the default output. Select Zsh or portable `sh` in configuration or per
build:

```console
wiz c build src/main.wiz --target zsh
wiz c build src/portable.sh --target bash
wiz c build src/portable.zsh --target sh
```

Bundle literal sourced modules—including files beneath `wiz_modules`—and compact the lowered
output when shipping a standalone executable:

```console
wiz c build src/main.wiz --bundle --minify
wiz fmt --minify --write src/release.wiz
```

Wiz transpiles the shared Bourne-shell subset in `.wiz`, `.sh`, and `.zsh`
inputs. Target-specific constructs that cannot be preserved, such as arrays in
`sh`, are errors rather than lossy rewrites.

## Types and declarations

Use Bash-shaped declarations:

```wiz
declare -rxT path CONFIG="/etc/example/config"
declare -T string[] services=("web" "worker")
declare -xT int PORT=8080
```

External APIs belong in `.d.wiz` files:

```wiz
declare command deploy(destination: path, ...arguments: string[]): status

declare command systemctl {
    restart(service: string): status
}

declare env HOME: path
```

Document public functions and declarations with contiguous shell-native `##`
comments. `@param`, `@returns`, and `@example` tags appear in editor hover,
completion details, and signature help while remaining valid shell comments.

Wiz bundles ambient declarations for Bash, coreutils, and the Wiz CLI. Optional
command surfaces are installable from `@types/*` packages and imported with
`source -T`, which produces no runtime code:

```wiz
source -T "@types/python/uv"
source -T "@types/common/git"
source -T "@types/network/dns"
source -T "@types/security/openssl"
source -T "@types/common/text"
source -T "@types/system/accounts"
```

The target shell contributes typed builtins automatically, including `alias`,
`export`, `set`, `readonly`, `declare`, `local`, and `typeset`. Focused packages
add full option completion for tools such as `rg`, adduser/useradd, sudo, GPG,
OpenSSL, DNS clients, and network scanners.

Binary output must not pass through command substitution because Bourne-family
shell variables cannot contain NUL bytes. Wiz provides an opaque `bytes` type
that keeps the payload outside the variable:

```wiz
bytes capture archive -- command_that_writes_binary
bytes pipe "$archive" -- command_that_reads_binary
bytes save "$archive" "./archive.bin"
bytes dispose "$archive"
```

`bytes read`, `emit`, and `length` cover file input, stdout, and byte counts.
Interpolating a `bytes` handle as normal text is a `WIZ4005` error.

## Editor support

The `wiz.wiz-language` VS Code extension registers `.wiz` and `.d.wiz`, syntax
highlighting, diagnostics, completion, hover, definitions, references, rename,
signature help, semantic tokens, code actions, and formatting. It launches:

```console
wiz c lsp --stdio
```

If the editor cannot find Wiz, set `wiz.server.path` to the installed executable.
The repository recommends Biome for TypeScript, JavaScript, and JSON and enables
format/fix actions on save.
