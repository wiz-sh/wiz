---
title: "Getting started"
description: "Install Wiz, create a package, compile a typed shell entry point, and use the editor tooling."
---

## Install from this repository

Wiz uses Bun for installation, builds, and tests:

```console
git clone https://github.com/hazelcaffe/wiz.git
cd wiz
bun install
bun run build
bun link --cwd apps/cli
```

Confirm the linked executable is the checkout you built:

```console
wiz --version
wiz --help
```

## Create a project

Run `wiz init` in an empty project directory. The optional name becomes the
package name; it does not create another nested directory.

```console
mkdir hello-wiz
cd hello-wiz
wiz init hello-wiz
```

The command creates `manifest.json`, `config.wiz.json`, `.gitignore`, and an
executable `src/index.sh`. Existing files are preserved.

Create `src/main.wiz`:

```wiz
#!/usr/bin/env bash

greet(string name="world"): void {
    printf 'Hello, %s!\n' "$name"
}

greet "Wiz"
```

Check, build, and execute it:

```console
wiz check
wiz c build
bash dist/main.sh
```

The output is `Hello, Wiz!`. Use `wiz c build --target zsh` or
`wiz c build --target sh` to select another supported backend.

## Add editor support

Install the VS Code package built from `apps/vscode`, open the project folder,
and open `src/main.wiz`. The extension launches `wiz c lsp --stdio`; set
`wiz.server.path` when the editor process cannot find `wiz` on `PATH`.

Formatting is enabled on save. Hover `greet`, invoke completion at a command
position, or add `source "./helpers.wiz"` to navigate and complete symbols from
another file without opening it first.

Continue with [Wiz syntax](../language/syntax.md),
[package-manager commands](../tooling/cli.md), or the
[runnable examples](examples.md).
