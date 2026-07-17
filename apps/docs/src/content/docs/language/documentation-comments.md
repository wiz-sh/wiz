---
title: "Documentation comments"
description: "Attach hover and signature documentation to Wiz APIs with shell-native comments."
---

Wiz documentation comments begin with `##` and must immediately precede the
declaration they document. They remain valid comments in Bash, Zsh, and `sh`, so
they do not change runtime behavior.

```wiz
## Restarts a system service.
##
## @param service Unit name accepted by systemctl.
## @returns The systemctl exit status.
## @example restart_service "caddy"
restart_service(string service): status {
    systemctl restart "$service"
}
```

Supported structured tags are:

- `@param name description`
- `@returns description` or `@return description`
- `@example shell invocation`
- arbitrary tags such as `@deprecated` and `@see`

The language service renders the description and tags as Markdown in hover,
completion details, and signature help. Documentation follows symbols across
literal `source` boundaries, including helper files that are not open in the
editor. The formatter preserves the comment spelling and the compiler emits the
comments as ordinary shell comments.

Declaration files use the same convention:

```wiz
## Resolves a path to its canonical absolute form.
## @param arguments Flags and input paths accepted by the platform utility.
declare command realpath(...arguments: any[]): path
```
