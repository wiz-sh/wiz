# Shell compiler targets

The source uses the portable Wiz subset and can target all supported shells.
Bash is configured by default, while `--target` overrides one invocation.

```console
wiz c build
bash dist/main.sh

wiz c build src/main.wiz --target zsh
zsh dist/main.zsh

wiz c build src/main.wiz --target sh
sh dist/main.sh

wiz c build src/main.wiz --target fish
fish dist/main.fish

wiz c build src/main.wiz --target powershell
pwsh -File dist/main.ps1

wiz c build src/main.wiz --target cmd
# Run dist/main.cmd on Windows.
```

Each command prints `Target: portable`. Try adding `[[ -n "$name" ]]` or an
array and compiling to `sh` to see the `WIZ5003` portability diagnostic.
