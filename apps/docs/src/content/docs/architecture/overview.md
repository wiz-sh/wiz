---
title: "Architecture overview"
description: "See how package management, runtime execution, the Wiz compiler, tooling, and editor applications fit together."
---


The CLI is an application over independently testable packages. `@wiz/pm` owns Git
resolution, manifests, lockfiles, stores, links, approvals, and installation. `@wiz/runtime`
depends on its stable APIs to find and execute bins. Wiz tooling shares `@wiz/compiler`.

```mermaid
flowchart LR
    CLI[apps/cli] --> PM[@wiz/pm]
    CLI --> RT[@wiz/runtime]
    RT --> PM
    CLI --> C[@wiz/compiler]
    F[@wiz/formatter] --> C
    L[@wiz/linter] --> C
    LS[@wiz/language-service] --> C
    LS --> F
    LS --> L
    LSP[@wiz/lsp] --> LS
    VS[apps/vscode] --> LSP
```

Package resolution means materializing a Git dependency. Runtime resolution means locating
an executable. The dependency direction prevents package installation from depending on the
interactive command runner.
