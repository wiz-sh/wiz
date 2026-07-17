---
title: "Self-hosting"
description: "Deploy the registry Compose baseline behind Caddy or Nginx."
---

Validate the production baseline before deployment:

```console
cp .env.example .env
bun run registry:prod:validate
docker compose --env-file .env -f docker-compose.prod.yml up -d
```

The production Compose file uses persistent volumes, health checks, restart policies, non-root
application processes, and does not expose PostgreSQL or Redis. Run migrations as a one-shot task
before replacing API and worker instances.

Caddy can proxy a configured hostname with `reverse_proxy registry-api:3000`. Nginx should forward
`Host`, `X-Forwarded-Proto`, and `X-Request-ID`, disable request buffering for archive uploads when
appropriate, and enforce the configured archive-size limit. `REGISTRY_PUBLIC_URL` and WebAuthn
origin settings must use the public HTTPS URL.
