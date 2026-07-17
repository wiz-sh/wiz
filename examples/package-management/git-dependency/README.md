# Local Git dependency

This pair of packages demonstrates the same Git-backed flow used for remote
repositories. Initialize `logger` as a Git repository, then install it into the
application:

```console
cd logger
git init -b main
git add .
git commit -m "initial logger"

cd ../app
wiz install ../logger
wiz x logger -- "installed from Git"
wiz install --frozen-lockfile
```

The first install records the exact commit and materializes the package. The bin
prints `[log] installed from Git`; frozen installation verifies the lockfile
without selecting a different revision.
