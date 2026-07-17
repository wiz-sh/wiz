---
title: "Wiz overview"
description: "Meet Wiz: recognizable shell syntax with static types, boundary checks, portable targets, and editor intelligence."
---


Wiz is Bourne-family shell with erasable type syntax. Executable files use
`.wiz`; declarations for external commands, environment, and legacy libraries
use `.d.wiz`. Invocation remains shell syntax:

```wiz
declare -T string service="caddy"
restart_service(string name): status {
    systemctl restart "$name"
}
restart_service "$service"
```

Generated Bash, Zsh, or `sh` uses ordinary assignments, functions, positional
parameters, quoting, and exit status. Untyped shell in the shared supported
subset retains its behavior. Target validation reports constructs that cannot
be represented safely by the selected shell.
