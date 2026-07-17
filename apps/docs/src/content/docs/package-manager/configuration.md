---
title: "Package-manager configuration"
description: "Understand user, project, environment, and lockfile configuration boundaries."
---

`~/.config/wiz.json` contains registry aliases, user scope routing, and credentials. `manifest.json`
contains package metadata, dependency declarations, workspace patterns, and credential-free project
registry routing. `wiz.lock` records exact resolved sources and integrity.

`WIZ_CONFIG`, `WIZ_REGISTRY`, and `WIZ_TOKEN` make CI behavior explicit. Never commit a populated
user config or `.env`; commit `.env.example` with placeholders and document required variables.
