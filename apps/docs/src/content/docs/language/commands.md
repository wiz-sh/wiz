---
title: "Commands"
description: "Type-check ordinary shell command invocation, pipelines, redirections, status results, and declared external APIs."
---


Simple commands keep Bash word and quoting rules. Known Wiz functions and `.d.wiz` command
declarations provide argument counts and types; unknown external commands remain executable
and follow the configured warning/error policy.

```wiz
command curl --fail --output "$target" "$url"
printf '%s\n' "$value" | command logger -t example
```

Status-returning calls can be used directly in `if` and `while`. The linter warns about unsafe
`eval`, dynamic sources, unquoted expansions, and destructive recursive removal patterns.
