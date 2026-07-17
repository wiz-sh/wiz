# `@wiz/registry-client`

This package is the only HTTP and user-configuration boundary for Wiz registries. It provides
registry URL selection, scope routing, credential precedence, safe retry behavior, structured
errors, and typed methods used by the package manager and CLI.

Tokens come from `WIZ_TOKEN` or `~/.config/wiz.json`; project manifests may select aliases but
cannot contain credentials. HTTP is rejected except for loopback development registries.
