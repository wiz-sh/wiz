# Wiz manifest schema

`manifest.schema.json` describes the package-style `manifest.json` written by
current Wiz releases. The runtime parser remains backward compatible with the
legacy `{ "manifestVersion": 1, "package": { ... } }` shape, but serializers
always produce the schema-backed top-level form.

Editors discover this schema through the generated `$schema` property. Update
the schema, parser validation, serialization tests, and manifest documentation
together whenever a public field changes.
