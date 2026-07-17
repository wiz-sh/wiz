---
title: "Registry security"
description: "Review the registry threat model and production controls."
---

The registry parameterizes SQL through Drizzle, rate-limits authentication and mutation routes,
rotates sessions, enforces CSRF for cookie mutations, hashes credentials, restricts token scopes,
and redacts secrets from structured logs. Package archives are inspected as data and never execute
install scripts on the server.

Webhook destinations require HTTPS and reject credentials, loopback, link-local, private, and
internal hostnames after DNS resolution. Deliveries use bounded timeouts and response bodies,
manual redirect handling, HMAC signatures, event IDs, retry backoff, and delivery history.

Set a unique password, session secret, and each pepper in production. Keep PostgreSQL, Redis, and
object-storage administration ports private. Terminate TLS at a trusted reverse proxy and forward
the original host and scheme.
