# `@types/security`

Detailed declarations for OpenSSL, GnuPG, age, signing utilities, key stores,
and checksum tools. Install the aggregate and import only the area in use:

```console
wiz install @types/security
```

```wiz
source -T "@types/security/gpg"
source -T "@types/security/openssl"
```

Binary-producing commands should be captured through `bytes` so ciphertext,
keys, signatures, and random data never pass through Bash command substitution.
