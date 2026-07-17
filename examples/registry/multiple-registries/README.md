# Multiple registries

Run two registry aliases and route `@internal` to the second one:

```console
wiz registry add official http://localhost:3001
wiz registry add internal http://localhost:3002
wiz registry set-default official
```

Project manifests can select the alias for a scope without containing either registry token.
