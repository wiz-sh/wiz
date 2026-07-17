# Public registry package

Publish a versioned command that anyone can install and execute.

```console
wiz login
wiz publish --access=public
wiz install @example/hello
wiz x hello -- Registry
```

The command prints `Hello, Registry!`. Publication validates the manifest and archive before making
version `1.0.0` immutable.
