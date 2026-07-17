---
title: "Registry selection"
description: "Configure official and self-hosted registries with scope routing."
---

User configuration lives at `~/.config/wiz.json`, or `WIZ_CONFIG`. Selection precedence is command
flags, `WIZ_REGISTRY`, project mappings, user scope mappings, project default, user default, then
the built-in official registry.

```console
wiz registry add internal https://packages.example.com
wiz registry set-default internal
wiz registry ping internal
```

Project manifests may select aliases and scopes but never contain tokens. Plain HTTP is rejected
except loopback development endpoints or an explicitly insecure development entry.
