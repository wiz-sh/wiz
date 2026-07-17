# @wiz/pm

Internal package-management services for Wiz, including schema-backed manifests,
lockfiles, dependency resolution, storage, approvals, workspaces, and command
operations. This workspace is bundled into the CLI and is not published
independently.

Current `manifest.json` files use package-style top-level metadata. The parser
keeps legacy nested manifests readable, while the serializer and `wiz init`
always produce the current schema-backed representation.
