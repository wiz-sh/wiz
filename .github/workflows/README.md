# Continuous integration

`ci.yml` separates fast quality checks from cross-platform tests, clean builds,
documentation, extension packaging, and the Docker-backed registry suite.
`security.yml` runs CodeQL and pull-request dependency review. Tagged releases
build verified CLI and VS Code artifacts through `release.yml`.

Keep CI commands aligned with root Bun scripts so contributors can reproduce
the same checks locally without learning a second workflow. Required jobs must
not skip difficult registry, editor, or declaration-package coverage.
