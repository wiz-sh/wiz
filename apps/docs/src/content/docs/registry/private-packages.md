---
title: "Private packages"
description: "Control private metadata, downloads, collaborators, and grants."
---

Private package metadata and archives require owner, organization, collaborator, team, or explicit
access-grant permission. The permission levels are `read`, `triage`, `publish`, `manage`, and
`admin`.

An unauthorized request receives `PACKAGE_NOT_FOUND`, not an access-denied response, preventing
package enumeration. Search follows the same rule. Revoking a grant blocks future metadata and
archive requests immediately; existing lockfiles contain integrity and source metadata but no
credential that bypasses authorization.
