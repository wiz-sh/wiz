---
title: "Wiz"
description: "Build, type-check, package, and run shell projects with one integrated toolchain."
template: splash
hero:
    tagline: "A multi-source package manager and typed language for shell projects."
    actions:
        - text: "Get started"
          link: "/guides/getting-started/"
          icon: "right-arrow"
          variant: "primary"
        - text: "Learn Wiz"
          link: "/language/overview/"
          icon: "open-book"
        - text: "Browse examples"
          link: "/guides/examples/"
---

Wiz treats shell projects as real software. Its package manager installs exact
Git revisions, understands workspace monorepos, and runs project or package
commands without hiding argument and exit-status behavior. Wiz adds types while
keeping declarations, invocation, quoting, pipelines, and control flow shaped
like shell.

```wiz
declare -T int port=8080

## Starts the local service.
## @param host Address to bind.
start_server(string host, path root="/srv/app"): status {
    printf 'Starting %s:%s from %s\n' "$host" "$port" "$root"
}

start_server "127.0.0.1"
```

The compiler checks this source and emits ordinary Bash, Zsh, or portable `sh`.
The same project model powers the formatter, linter, language server, source
maps, and VS Code extension, so command-line and editor results agree.

## One toolchain

- **Git dependencies:** lock commit identities, install transitive graphs,
  expose bins, link working copies, and share dependencies across workspaces.
- **Typed shell:** catch argument, assignment, environment, and command-boundary
  mistakes while preserving recognizable shell syntax.
- **Production editor support:** diagnostics, sourced-file IntelliSense, hover,
  navigation, references, rename, signature help, semantic highlighting,
  formatting, and quick fixes.
- **Portable output:** target Bash by default, or select Zsh and `sh` when the
  source uses features the target can preserve.

Start with the [installation and first-project guide](guides/getting-started.md),
then use the [examples catalog](guides/examples.md) to explore package scripts,
monorepos, declaration files, documentation comments, configuration inheritance,
and every compiler target.
