# Package scripts and bins

This package exposes the same executable as a manifest script and a named bin.

```console
wiz script greet -- Hazel
wiz x hello -- Hazel
wiz script root
wiz needs bash
wiz root
```

Both greeting commands print `Hello, Hazel!`. The root script proves command
processes inherit the project environment. `wiz needs` documents an external
runtime prerequisite, while `wiz root` works from any nested directory.
