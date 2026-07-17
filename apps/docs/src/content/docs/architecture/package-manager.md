---
title: "Package-manager architecture"
description: "Learn how Wiz validates manifests, resolves Git revisions, materializes graphs, and executes workspace-safe installs."
---


`@wiz/pm` validates `manifest.json`, resolves Git revisions, creates deterministic lockfiles,
stores immutable commits under `WIZ_HOME`, and atomically swaps complete `wiz_modules` trees.
Package and bin names, manifest paths, symlinks, and indexes are checked against traversal.

Postinstall scripts are denied until the exact package identity—repository and commit—is in
`wiz.approvals.json`. Updating a commit invalidates its previous approval. `@wiz/runtime`
handles `run`, `script`, `x`, and `dlx`; it receives project/package identities from PM and
constructs the exported `WIZ_*` environment.

## Manifest model

Current manifests place `name`, optional `version`, `main`, descriptive
metadata, scripts, bins, dependencies, and workspaces at the top level. This is
deliberately close to `package.json`, while dependency entries remain Git or
workspace selectors. `wiz init` writes the public JSON Schema URL so editors can
validate fields and offer completion.

The parser still accepts the original `manifestVersion: 1` and nested `package`
shape for compatibility. Serializing any manifest emits only the current shape;
lockfile compatibility is independent and remains versioned by
`lockfileVersion`.

## Monorepos

A root manifest may declare `workspaces` glob patterns. Discovery walks upward
from the current package, expands those patterns within the canonical root, and
indexes packages by manifest name. Duplicate names, paths outside the root, and
stale lock entries are errors.

Workspace dependencies use `{ "workspace": "*" }`. The resolver combines local
and Git packages in one cycle-checked graph. Git packages remain immutable store
copies; workspace packages are live links with their transitive `wiz_modules`
links constructed from the same lock graph. Lockfiles keep relative workspace
paths so a repository can move between machines without changes.

```json
{
    "$schema": "https://raw.githubusercontent.com/hazelcaffe/wiz/main/packages/pm/schemas/manifest.schema.json",
    "name": "suite",
    "private": true,
    "workspaces": ["apps/*", "packages/*"],
    "dependencies": {
        "shared": { "workspace": "*" }
    }
}
```

Running `wiz install` at this root installs the root and every matched package in
name order. Each package keeps its own lockfile, so `wiz install
--frozen-lockfile` can reproduce one package independently. `wiz workspace run
check --if-present` runs the named script across packages and stops on the first
failure.
