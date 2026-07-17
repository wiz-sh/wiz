---
title: "Registry architecture"
description: "Run the self-hostable registry with Drizzle, PostgreSQL, Redis, storage, and SMTP."
---


The Wiz registry is a Bun service. PostgreSQL access is exclusively through Drizzle ORM's Bun SQL
driver: table definitions provide query types, Drizzle Kit produces reviewed SQL migrations, and
the Drizzle migrator records applied hashes in `drizzle.registry_migrations`. The application does
not maintain a second query client or migration ledger.

```text
HTTP API / worker → typed repositories → Drizzle ORM → Bun SQL → PostgreSQL
                                  └────→ generated migration journal
```

For local development, the root `docker-compose.dev.yml` starts PostgreSQL, Redis, MinIO, Mailpit,
the migration task, API, and worker. The ignored root `.env` points at those services. Run:

```console
bun run registry:test:e2e
```

The wrapper builds images, applies real Drizzle migrations, verifies health, exercises HTTP and SDK
workflows, discovers email through Mailpit, generates TOTP codes, drives a virtual WebAuthn
authenticator, tests publishing and authorization, and always removes its network and volumes.
External SMTP credentials belong only in the ignored `.env.smtp-e2e.local` or deployment secrets.
