# Registry deployment examples

Each directory contains a real Compose configuration that is validated by the examples integration
suite. They demonstrate topology and configuration boundaries; use the root development Compose
stack for source builds and autonomous end-to-end tests.

```console
bun run example registry/docker-compose --dry-run
docker compose -f registry/docker-compose/compose.yaml config
```

Development defaults are intentionally obvious and must be replaced before deployment.
