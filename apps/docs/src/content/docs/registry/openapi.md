---
title: "OpenAPI and Scalar"
description: "Inspect and consume the generated registry API contract."
---

OpenAPI is generated from the same Elysia schemas that validate requests. It is not maintained as a
separate hand-written file.

```console
open http://localhost:3000/openapi
curl --fail http://localhost:3000/openapi/json > registry.openapi.json
```

Routes have stable operation IDs, tags, typed parameters and bodies, security declarations, and a
shared structured error shape. The reusable `@wiz/registry-client` wraps transport failures as
`RegistryError` with `code`, HTTP `status`, `requestId`, and typed `details`.
