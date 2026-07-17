---
title: "Dependency sources"
description: "Mix registry, Git, local, and workspace dependencies safely."
---

```json
{
    "dependencies": {
        "@wiz/runtime": "^1.4.0",
        "git-helper": {
            "git": "https://code.example/helper.git",
            "rev": "4f92820abc"
        },
        "local-helper": {
            "path": "../local-helper"
        }
    }
}
```

Lock records preserve their exact source. Git dependencies stay Git-based, registry archives retain
URL, integrity, size, package, registry, and exact version, and workspaces remain live local links.
Credentials and presigned upload URLs are never serialized.
