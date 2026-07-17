---
title: "Packages and search"
description: "Name, discover, version, deprecate, and download registry packages."
---

Valid names are `package-name`, `@user/package-name`, and `@organization/package-name`. Names are
normalized case-insensitively and reject traversal, credentials, whitespace, control characters,
and invalid scope separators. Ownership is checked from database identities, never inferred only
from a matching prefix.

Published versions are immutable. Deleting a package creates a tombstone and cannot make an altered
archive publishable under an old version. Downloads include `X-Wiz-Integrity`; public immutable
versions receive long-lived immutable caching while private downloads use `no-store`.

Search supports `q`, `scope`, `owner`, `keyword`, `visibility`, `sort`, `limit`, and opaque `cursor`
parameters. Unauthorized private packages are filtered without disclosing their names or page
positions.
