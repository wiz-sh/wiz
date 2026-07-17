# Complete development registry

This Compose topology documents PostgreSQL, Redis, S3-compatible storage, SMTP capture, API, and
worker processes. For the tested source-build environment use the repository root command:

```console
bun run registry:test:e2e
```

`compose.yaml` is a deployable image-based equivalent. Replace every development default before
exposing it outside localhost.
