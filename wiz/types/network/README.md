# `@types/network`

Typed declarations are split into DNS, diagnostics and packet capture, host
scanning, sockets, transfer clients, and remote access. Import the aggregate or
only the surface a script uses:

```wiz
source -T "@types/network/dns"
source -T "@types/network/scanning"
```

Cryptographic tools live in `@types/security`, keeping network-only projects
small and their completion lists focused.
