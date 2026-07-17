# Documented sourced APIs

This project demonstrates shell-native `##` documentation, typed sourced
functions, and editor navigation into a helper that does not need to be open.

Open `src/main.wiz`, hover `greet`, request signature help after typing a space,
or use Go to Definition. The hover includes `@param`, `@returns`, and `@example`
metadata from `src/helpers.wiz`.

```console
wiz check
wiz c build
bash dist/main.sh
```

The script prints `Hello, documented Wiz!`.
