---
title: "Runnable examples"
description: "Choose a tested Wiz project for package management, typed shell features, configuration, or compiler targets."
---

Every example under `examples/` is exercised by the integration suite. Copy one
to a temporary directory before experimenting if you want to keep the checked-in
source unchanged.

## Package management

| Example | What it demonstrates |
| --- | --- |
| `package-management/command-runner` | Scripts, argument forwarding, bins, `wiz root`, and `wiz needs` |
| `package-management/git-dependency` | Commit-pinned local Git installation, lockfiles, and package bins |
| `package-management/monorepo` | Workspace discovery, local dependency linking, and workspace script execution |

## Registry and published packages

| Example | What it demonstrates |
| --- | --- |
| `registry/docker-compose` | PostgreSQL, Redis, MinIO, Mailpit, API, and worker topology |
| `registry/local-filesystem` | Single-node persistent archive storage |
| `registry/s3-compatible` | S3-compatible archive configuration with MinIO |
| `registry/private-registry` | Restrictive CORS, HTTPS origin, and private-package deployment |
| `registry/multiple-registries` | Two aliases and scope-based routing |
| `packages/public-package` | A public versioned package and executable |
| `packages/private-package` | Private publication and non-disclosing access |
| `packages/org-package` | Organization ownership and typed executable source |
| `packages/mixed-git-registry` | Registry and commit-pinned Git dependencies in one manifest |

## Typed shell

| Example | What it demonstrates |
| --- | --- |
| `wiz/typed-variables` | Scalar and collection declarations |
| `wiz/typed-functions` | Named parameters, defaults, and result channels |
| `wiz/declaration-files` | External command and environment APIs in `.d.wiz` |
| `wiz/type-packages` | Installed declaration packages and `source -T` imports |
| `wiz/binary-data` | NUL-safe capture, storage, length checks, and byte-exact emission |
| `wiz/sourced-files` | Static source resolution and cross-file checking |
| `wiz/documentation` | `##` docs in hover, completion, and signature help |
| `wiz/config-inheritance` | Shared configuration and project-level overrides |
| `wiz/compiler-targets` | Bash, Zsh, `sh`, Fish, PowerShell, and CMD emission |
| `wiz/complete-project` | Multi-file checking, linting, formatting, maps, and execution |

From a Wiz example directory, the usual loop is:

```console
wiz format --check .
wiz lint .
wiz check
wiz c build
```

Each local README includes its entry point, expected output, and any command that
differs from that loop.
