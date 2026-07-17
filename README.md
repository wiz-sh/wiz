# Wiz

Wiz is a typed shell language with an integrated package manager and command
runner. It keeps familiar shell syntax and targets Bash, Zsh, `sh`, Fish,
PowerShell, and CMD.

```wiz
declare -T int port=8080

serve(string host, path root="/opt/server"): status {
    command server --host "$host" --port "$port" --root "$root"
}

serve "127.0.0.1"
```

`wiz c build` emits shell code and a source map. Bash is the default; use
`--target zsh`, `--target sh`, `--target fish`, `--target powershell`, or
`--target cmd` when needed. `wiz check`, `format`, `lint`,
`run`, and `lsp` share the same parser and semantic model. See
[the documentation site](apps/docs/src/content/docs/index.md).

```console
wiz src/main.wiz -- argument
wiz check
wiz watch src/main.wiz
wiz c build src/main.wiz --target zsh
wiz c build src/main.wiz --target powershell
wiz c build src/portable.sh --target bash
```

Binary streams are supported without asking Bash variables to contain NUL
bytes. Wiz keeps `bytes` payloads in owned temporary files and exposes explicit
byte-safe operations:

```wiz
bytes capture payload -- printf 'header\0body'
bytes pipe "$payload" -- consumer
bytes save "$payload" "./payload.bin"
bytes dispose "$payload"
```

Focused declaration packages provide option-aware completion for GPG, OpenSSL,
DNS clients, Nmap, netcat/Ncat, socat, packet capture, and related tools:

```console
wiz install @types/security @types/network
```

Scoped modules use shell-shaped exports and an extended `source` option:

```wiz
source -I greeting greet -- "./helpers.wiz"
```

The module publishes values with `export greeting` and functions with
`export -f greet`. The Bash backend evaluates scoped modules in isolation, so
private declarations do not leak into the caller.

Static source graphs can be shipped as a single compact executable:

```console
wiz c build src/main.wiz --bundle --minify
wiz fmt --check .
wiz lint .
```

## Create a project

```bash
mkdir my-package
cd my-package
wiz init
```

`wiz init` derives the package name from the current directory. Pass a name to
override it:

```bash
wiz init my-package
```

The command creates `manifest.json`, `config.wiz.json`, and an executable
`src/index.sh`. It ensures `wiz_modules/` and `dist/` are ignored and refuses to
replace existing project files.

Current manifests use package-style top-level metadata and include a JSON
Schema for editor completion:

```json
{
    "$schema": "https://raw.githubusercontent.com/hazelcaffe/wiz/main/packages/pm/schemas/manifest.schema.json",
    "name": "my-package",
    "version": "1.0.0",
    "main": "src/index.sh",
    "scripts": {
        "check": "bash -n src/index.sh"
    },
    "bin": {
        "my-package": "src/index.sh"
    },
    "dependencies": {}
}
```

Git commits, rather than the optional display `version`, remain the source of
dependency identity. Wiz can read older versioned/nested manifests and rewrites
them to the current shape whenever it serializes an update.

## Create a monorepo

```bash
wiz init my-suite --monorepo
mkdir -p packages/shared
cd packages/shared
wiz init shared
cd ../..
wiz install --workspace shared
```

The root manifest owns workspace patterns:

```json
{
    "$schema": "https://raw.githubusercontent.com/hazelcaffe/wiz/main/packages/pm/schemas/manifest.schema.json",
    "name": "my-suite",
    "private": true,
    "workspaces": ["packages/*", "apps/*"],
    "dependencies": {
        "shared": {
            "workspace": "*"
        }
    }
}
```

Workspace dependencies are live links, so edits are immediately visible. Wiz
records portable relative paths in `wiz.lock.json`, validates every path against
the root patterns, and rejects duplicate package names. Use `wiz workspace list`
and `wiz workspace root` from any nested package.

## Add dependencies

Pass a Git URL or local repository path to `wiz install` or `wiz i`. Wiz reads
the fetched package's manifest to determine its dependency name, saves the
repository object in `manifest.json`, installs the complete transitive graph,
and updates `wiz.lock.json`:

```bash
wiz i https://github.com/example/logger.git
wiz i ../logger --branch main
wiz install ../logger --commit 3d8f9f8d4c2e
```

Adding a repository is separate from `--global` and `--frozen-lockfile`
installation modes, so those combinations are rejected.

## Link a package during development

Register the current working copy and expose its bins through `$WIZ_HOME/bin`:

```bash
cd my-package
wiz link
```

Attach that live package to another project:

```bash
cd ../consumer
wiz link my-package
```

`wiz x <bin>`, `wiz x <package>/<bin>`, and direct bin execution all use the
working copy. Ensure `~/.wiz/bin` is on `PATH` when using the default Wiz home.

Remove a project link with `wiz unlink <package>`. Remove the global
registration from its source directory with `wiz unlink`, or from elsewhere
with `wiz unlink --global <package>`.

## Run a package temporarily

`wiz dlx` fetches a Git-backed package, builds an isolated temporary dependency
tree, runs its default bin, and removes the temporary project afterward:

```bash
wiz dlx https://github.com/example/tool.git -- --help
wiz dlx ../tool --branch main --bin format -- input.sh
```

The fetched commits remain in Wiz's shared cache, but the command does not edit
the current manifest or lockfile, create local `wiz_modules`, install global
packages, or register global bins.
