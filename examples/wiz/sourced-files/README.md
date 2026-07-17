# Sourced files

`wiz check` discovers and checks `helpers.wiz`. The scoped source imports only
the exported `greet` function, then `wiz src/main.wiz` compiles and runs the
program directly.

```wiz
source -I greet -- "./helpers.wiz"
```

The helper uses Bash's existing function-export spelling:

```wiz
export -f greet
```
