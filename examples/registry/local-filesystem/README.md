# Local filesystem storage

This small self-hosting profile persists package archives in a named volume. It is appropriate for
local development or a backed-up single-node installation.

```console
docker compose -f compose.yaml config
docker compose -f compose.yaml up -d
```
