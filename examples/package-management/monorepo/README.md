# Wiz monorepo

This example has an application that consumes a live `shared` workspace.

```console
cd apps/demo
wiz install
bash index.sh
```

The command prints `Hello from shared`. Edit `packages/shared/index.sh` and run
the application again; no reinstall is necessary because workspace packages are
linked rather than copied.
