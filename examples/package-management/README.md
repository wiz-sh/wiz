# Package management

Create a shell package with `wiz init`, add a local or remote Git dependency with
`wiz install <repo>`, execute its bin with `wiz x package/bin`, and reproduce the exact graph
with `wiz install --frozen-lockfile`. Use `wiz link` in a dependency and `wiz link <name>` in a
consumer for a live development override.

The complete [monorepo example](monorepo/README.md) also demonstrates live
local dependencies.

Continue with [package scripts and bins](command-runner/README.md) and a
[commit-pinned local Git dependency](git-dependency/README.md) for runnable
end-to-end workflows.
