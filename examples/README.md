# Wiz examples

The examples are small, runnable projects that exercise the same CLI paths as a
user project. They are also executed by the integration suite, so their commands
and generated shell output cannot silently drift away from the implementation.

## Run an example

The example runner discovers every project, copies it to an isolated temporary
workspace, and invokes the repository CLI. This keeps generated files, Git
repositories, lockfiles, and installed packages out of the checked-in examples.

From this directory:

```console
bun run example list
bun run example hello-world
bun run example wiz/compiler-targets
bun run example command-runner -- Hazel
bun run example registry/docker-compose --dry-run
bun run example packages/public-package
bun run example all
```

Use `--dry-run` to inspect commands without executing them. Use `--keep` to retain
the temporary working copy for exploration; the runner prints its location.

## Package management

- [`package-management`](./package-management) demonstrates registry, Git, and workspace package
  manifest.
- [`package-management/monorepo`](./package-management/monorepo) demonstrates
  workspace discovery, local dependency linking, and workspace scripts.
- [`package-management/command-runner`](./package-management/command-runner)
  demonstrates scripts, bins, runtime requirements, and project-root discovery.
- [`package-management/git-dependency`](./package-management/git-dependency)
  demonstrates commit-pinned local Git installation and frozen lockfiles.

## Typed shell

The [`wiz`](./wiz) directory progresses from hello world and typed declarations
through functions, environment boundaries, declaration files, sourced modules,
installable type packages, documentation comments, configuration inheritance,
runtime-check modes, six shell targets, formatting, linting, bundling,
minification, and a complete multi-file project.

## Registry and publication

- [`registry`](./registry) contains validated Compose configurations for a full
  development stack, filesystem storage, S3-compatible storage, private
  hosting, and multiple registries.
- [`packages`](./packages) contains public, private, organization-scoped, and
  mixed Git/registry publishable package manifests.

From any Wiz example directory, run:

```console
wiz check
wiz c build
bash dist/main.sh
```

Some examples use a different entry filename; each local README lists the exact
commands and expected output.
