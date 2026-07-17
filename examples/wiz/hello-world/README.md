# Hello world

Run `wiz main.wiz` to print `Hello, Wiz!`, or `wiz c build` to create
`dist/main.sh` and its source map.

The same source exercises alternate backends without changing its shell-shaped
invocation syntax:

```console
wiz c build main.wiz --target zsh
zsh dist/main.zsh

wiz c build main.wiz --target sh
sh dist/main.sh
```
