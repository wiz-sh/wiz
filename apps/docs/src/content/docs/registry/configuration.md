---
title: "Registry configuration"
description: "Configure HTTP, PostgreSQL, Redis, WebAuthn, storage, mail, logging, and telemetry."
---

Copy `.env.example` to the ignored `.env` for local deployment. Never commit the populated file.
The principal settings are:

| Area | Variables |
| --- | --- |
| HTTP | `REGISTRY_HOST`, `REGISTRY_PORT`, `REGISTRY_PUBLIC_URL`, `CORS_ORIGINS` |
| Database | `DATABASE_URL` |
| Security | `SESSION_SECRET`, `TOKEN_PEPPER`, `PASSWORD_PEPPER` |
| Passkeys | `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGIN` |
| Mail | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_ADDRESS` |
| Storage | `STORAGE_DRIVER`, `STORAGE_PATH`, and the `S3_*` variables |
| Operations | `REDIS_URL`, `LOG_LEVEL`, `LOG_FORMAT`, `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT` |

Production public URLs must match the TLS origin presented by the reverse proxy. WebAuthn verifies
both the origin and relying-party ID, so proxy rewrites must not change the externally visible host.
Set `CORS_ORIGINS` to a comma-separated allowlist; wildcard browser credentials are not enabled.
