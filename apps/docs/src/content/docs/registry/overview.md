---
title: "Registry overview"
description: "Understand the official and self-hosted Wiz package registry."
---

The registry stores immutable Wiz package versions while the package manager continues to support
Git and local workspace dependencies. A project can use all three sources in one lockfile. Registry
archives are never executed by the server.

```text
wiz publish → publish transaction → archive validation → immutable version
wiz install → metadata resolution → archive download → integrity check → Wiz store
```

The service is an Elysia application on Bun. PostgreSQL is accessed exclusively through Drizzle
ORM, Redis backs distributed rate limits, and archives use either local filesystem or S3-compatible
storage. `/openapi` renders Scalar, `/openapi/json` returns the generated OpenAPI 3.1 contract,
and `/health` plus `/ready` support container orchestration.

Public, private, user-scoped, and organization-scoped packages are supported. Private package
lookups deliberately use the same not-found response as absent packages.

Start the isolated stack and run its autonomous API, browser, SMTP, and client tests with:

```console
bun run registry:test:e2e
```
