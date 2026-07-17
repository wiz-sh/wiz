# Bundling and minification

This project combines a typed Wiz module and a legacy Bash module into one compact executable.
Both source statements are resolved during project analysis; the generated file has no runtime
dependency on the original source tree.

```console
wiz check
wiz c build --bundle --minify
bash dist/main.sh
```

The output is:

```text
Hello, bundled Wiz!
Legacy module loaded.
```

Literal `.wiz` and `.sh` source paths can be bundled, including paths beneath `wiz_modules`.
Dynamic paths such as `source "$PLUGIN"` remain runtime boundaries and produce a diagnostic.
