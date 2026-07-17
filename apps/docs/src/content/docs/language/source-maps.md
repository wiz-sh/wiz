---
title: "Source maps"
description: "Map generated shell ranges back to typed source for diagnostics, debugging, and editor navigation."
---


Every emitted shell file can have a sibling map, such as `dist/name.sh.map` or
`dist/name.zsh.map`. The JSON document records map and compiler versions,
source/generated filenames, and generated/source start and end positions. Named
mappings identify functions where available.

Use `wiz c map dist/main.sh:20` to print the nearest source line. Library consumers can call
`loadSourceMap`, `mapGeneratedToSource`, and `mapSourceToGenerated` from `@wiz/compiler`.

```json
{
    "version": 1,
    "compilerVersion": "0.1.0",
    "sourceFile": "/project/src/main.wiz",
    "generatedFile": "/project/dist/main.sh",
    "mappings": [
        {
            "source": {
                "start": { "line": 2, "column": 0, "offset": 21 },
                "end": { "line": 2, "column": 24, "offset": 45 }
            },
            "generated": {
                "start": { "line": 1, "column": 0, "offset": 20 },
                "end": { "line": 1, "column": 9, "offset": 29 }
            }
        }
    ]
}
```

Positions are zero-based inside the JSON and CLI output is one-based. Loading
rejects unsupported versions, negative positions, and ranges whose end precedes
their start rather than silently accepting corrupt debugger data.
