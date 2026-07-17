# Configuration inheritance and runtime checks

`config.wiz.json` inherits shared strictness, formatter, and linter settings from
`config.base.json`, then selects output paths and `runtimeChecks: "all"` locally.

```console
wiz c config
wiz check
wiz c build
bash dist/main.sh
```

The emitted script validates both the typed assignment and function boundary,
then prints `Retries: 3`.
