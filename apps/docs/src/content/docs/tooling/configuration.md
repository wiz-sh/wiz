---
title: "Configuration"
description: "Configure compiler targets, runtime checks, strictness, formatting, lint rules, files, discovery, and inheritance."
---


Wiz discovers `config.wiz.json` upward from the current directory. Relative directories are
normalized against the configuration file. Unknown keys are errors; `extends` resolves another
JSON file relative to the child.

```json
{
    "compiler": {
        "target": "bash",
        "rootDir": "./src",
        "outDir": "./dist",
        "sourceMap": true,
        "runtimeChecks": "boundaries",
        "bundle": false,
        "minify": false
    },
    "typeChecking": {
        "strict": true,
        "allowAny": false,
        "implicitAny": false,
        "unknownCommands": "warning"
    },
    "formatter": {
        "indentStyle": "space",
        "indentWidth": 4,
        "lineWidth": 100,
        "quoteStyle": "preserve",
        "trailingNewline": true
    },
    "linter": {
        "enabled": true,
        "recommended": true,
        "rules": {}
    }
}
```

`compiler.target` accepts `"bash"`, `"zsh"`, or `"sh"`. Bash is the default.
Command-line `--target` overrides it for one build or check. The `sh` target
reports unsupported non-portable constructs before emission.

`compiler.bundle` emits independently runnable entry files by inlining literal Wiz and Bash
sources, including modules under `wiz_modules`. `compiler.minify` compacts the lowered target
output. Command-line `--bundle` and `--minify` enable either behavior for one build.

The JSON Schema is shipped at `@wiz/config/schema`.

Runtime validation enforces the same booleans, enums, integer limits, arrays,
and lint severities as the schema. Invalid configuration makes every project
command exit nonzero with a `WIZCFGxxx` diagnostic; unsafe values are never
merged into defaults. Paths inherited through `extends` resolve beside the file
that declared them. `files.include` and `files.exclude` are Bun glob patterns
relative to `projectRoot` and control project-wide build, check, format, and lint
discovery.
