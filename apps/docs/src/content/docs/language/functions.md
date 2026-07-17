---
title: "Functions"
description: "Define typed shell functions with named parameters, defaults, and separate status, stdout, stream, and void results."
---


```wiz
get_hostname(): string { hostname; }
is_active(string service): status { systemctl is-active --quiet "$service"; }
print_status(string service): void { printf '%s\n' "$service"; }
read_logs(string service): stream { journalctl -u "$service"; }
```

`string`, `status`, `void`, and `stream` describe stdout, meaningful exit status, no captured
result, and streaming stdout respectively. Parameters lower to `$1`, `$2`, and defaults:

```bash
serve() {
    local host="$1"
    local root="${2:-/opt/server}"
}
```

Calls never use parentheses: `serve "localhost"`.
