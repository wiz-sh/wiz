---
title: "Publishing packages"
description: "Prepare and publish a deterministic registry package."
---

Set a valid package name and semantic version in `manifest.json`, remove unresolved local
dependencies, authenticate, then run `wiz publish`. Use `--access=private` or `--access=public` to
choose visibility when permitted by organization policy.

Publishing is transactional and immutable. A failed validation does not create a visible version;
retry by creating a new publish transaction after correcting the package.
