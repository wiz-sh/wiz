# Wiz Registry

The registry is a self-hostable Bun service backed by PostgreSQL through Drizzle ORM. The schema
is defined in `src/database/schema*.ts`; Drizzle Kit generates append-only SQL in `migrations`, and
the Bun SQL Drizzle migrator applies it.

## Local infrastructure

The repository includes an ignored `.env` and a Compose stack with PostgreSQL, Redis, and Mailpit:

```console
bun run infra:up
bun run migrate
bun run test:integration
```

Mailpit accepts local SMTP on port `1025` and exposes its browser inbox at
`http://localhost:8025`. To exercise an external mail provider, replace the `SMTP_*` values in the
ignored `.env`; never commit provider credentials.

Stop containers with `bun run infra:down`. Add `--volumes` directly to `docker compose down` only
when intentionally discarding the local registry database.

## Schema changes

Edit the Drizzle table definitions, then generate and validate the migration:

```console
bun run db:generate
bun run db:check
```

Review generated SQL and snapshots before committing. Application code must use the typed Drizzle
database returned by `createDatabase`; raw PostgreSQL drivers and parallel migration ledgers are
not supported.
