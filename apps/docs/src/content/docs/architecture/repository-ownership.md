---
title: Repository ownership
description: "The dependency-safe plan for extracting Wiz into focused, independently releasable repositories."
---

Wiz is currently kept together while its first compatible package set is established. The eventual
split follows product boundaries, not individual folders, so every repository has a coherent release
and test surface.

| Repository | Owns | Published artifacts |
| --- | --- | --- |
| `wiz/compiler` | compiler and project configuration | `@wiz/compiler`, `@wiz/config` |
| `wiz/package-manager` | manifests, lockfiles, stores, registry/Git/local resolution, process runtime | `@wiz/pm`, `@wiz/runtime` |
| `wiz/linter` | lossless formatter and semantic linter | `@wiz/formatter`, `@wiz/linter` |
| `wiz/lsp` | language service and protocol server | `@wiz/language-service`, `@wiz/lsp` |
| `wiz/registry` | Elysia API, worker, migrations, Compose deployment, client SDK | registry image, `@wiz/registry-client` |
| `wiz/stdlib` | runtime standard library and installable declaration packs | `@wiz/stdlib`, `@types/*` Wiz packages |
| `wiz/cli` | command-line application and release packaging | `wiz` executable package |
| `docs` | Starlight documentation and runnable documentation checks | static documentation site |
| `vscode-extension` | thin editor client, grammar, snippets, icons | VSIX and marketplace extension |

`config` belongs with the compiler because it defines compiler projects and is consumed throughout the
language toolchain. `runtime` belongs with the package manager because executable discovery and package
materialization share the store, lockfile, and environment contract. Types and the standard library get
a dedicated repository: they release independently and should not force a compiler release when a CLI
declaration gains an option.

## Dependency direction

```text
stdlib/types ───────────────┐
                            │
compiler/config ──▶ formatter/linter ──▶ language-service/LSP ──▶ VS Code
        │                          │
        └──────────────────────────┴─────────────────────────────▶ CLI

registry-client ──▶ package-manager/runtime ─────────────────────▶ CLI
registry server ──▶ registry-client contract
```

No repository may depend on CLI or editor code. The registry server owns persistence but exposes only
HTTP contracts; the client never imports server or Drizzle internals.

## Safe extraction sequence

1. Tag and publish one compatible version of every public package from the integrated tree.
2. Extract repositories in dependency order: compiler, registry client/server, package manager,
   formatter/linter, LSP, stdlib/types, CLI, extension, then docs.
3. Replace `workspace:*` only after the dependency is available at the same release version. Never use
   relative `file:` dependencies in an independently clonable repository.
4. Move each package's unit tests, examples, API documentation, release workflow, ownership rules, and
   changelog with its implementation.
5. Keep a small conformance repository for cross-repository fixtures, compatibility matrices, and the
   release train. It contains no product implementation.
6. Run the existing clean build, shell matrix, registry Compose suite, CLI publish/install workflow, LSP
   protocol suite, and VS Code packaging before switching the default branch of any extracted repository.

This ordering prevents a cosmetic folder split from producing repositories that only work when checked
out beside one another. It also preserves atomic language changes until the compiler API is versioned
enough for the formatter and language service to upgrade independently.
