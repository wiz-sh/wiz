# Type packages

This project vendors a tiny package in `wiz_modules` to demonstrate the exact
shape produced by `wiz install @types/example-weather` without requiring a
network registry during the example suite.

`source -T "@types/example-weather"` makes the declaration available to the
compiler and editor, then disappears from `dist/main.sh`.

The same mechanism powers the official focused packages. For example:

```console
wiz install @types/common @types/network @types/security @types/system
```

```wiz
source -T "@types/network/dns"
source -T "@types/network/scanning"
source -T "@types/security/gpg"
source -T "@types/security/openssl"
source -T "@types/common/text"
source -T "@types/system/accounts"

dig +short example.com A
nmap -sV 192.0.2.10
rg --hidden --glob '*.wiz' 'declare -T' .
gpg --verify "./release.sig" "./release.tar"
openssl version -a
sudo useradd --create-home --shell /bin/bash example
```

Each focused file supplies literal option unions, typed positional arguments,
documentation hover, completion, and signature help without loading unrelated
command surfaces.

```console
wiz check
wiz c build
```
