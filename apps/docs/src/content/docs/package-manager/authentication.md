---
title: "Package-manager authentication"
description: "Store and supply registry credentials without leaking them into projects."
---

Use `WIZ_TOKEN` in CI. Interactive users can run `wiz login` or `wiz registry set-token`; the
configuration writer uses restricted permissions and atomic replacement. Output always masks token
values. `wiz logout` removes the selected credential and `wiz whoami` verifies the active identity.

The credential-provider boundary currently supports environment and user configuration and can add
native keychain providers without changing package resolution.
