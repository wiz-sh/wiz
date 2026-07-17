---
title: "Authentication"
description: "Use sessions, access tokens, passkeys, TOTP, recovery codes, and device login safely."
---

Browser requests use secure, HTTP-only sessions and a CSRF token for mutations. CLI and SDK
requests use bearer tokens. Passwords use Argon2id; access, verification, reset, and recovery values
are hashed before persistence.

```console
wiz login internal --token "$WIZ_TOKEN"
wiz whoami internal
wiz logout internal
```

Automation should inject `WIZ_TOKEN` rather than write credentials into a project. Personal and
automation tokens carry explicit scopes, expiry, and optional package restrictions. Tokens never
appear in manifests or lockfiles.

TOTP enrollment returns a setup secret once, then requires a valid RFC 6238 code. Recovery codes
are single-use and regeneration invalidates the previous set. Passkey challenges expire and are
single-use; the registry verifies origin, RP ID, credential counter, and credential ownership.
