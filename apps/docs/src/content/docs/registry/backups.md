---
title: "Backups and restoration"
description: "Back up PostgreSQL and immutable archives as one recoverable registry."
---

Take PostgreSQL backups with `pg_dump --format=custom` and copy or snapshot the archive store. Keep
the database backup timestamp and object-store generation together. Redis contains reconstructable
rate-limit and queue coordination state and is not the source of truth.

To restore, stop API and worker mutations, restore PostgreSQL into an empty database with
`pg_restore`, restore archive objects at their original keys, run `bun run --cwd apps/registry
migrate`, and verify `/ready`. Test restoration regularly by downloading a public and private
version and comparing its `X-Wiz-Integrity` value with the database record.
