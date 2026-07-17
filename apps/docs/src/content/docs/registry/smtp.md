---
title: "SMTP"
description: "Configure verification, reset, invitation, and security email delivery."
---

Configure an authenticated SMTP account with `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
`SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_ADDRESS`, and `SMTP_FROM_NAME`. Port 465 normally uses
implicit TLS; port 587 normally uses STARTTLS.

The development Compose stack uses Mailpit and the E2E suite discovers verification and reset links
through its API without human interaction. Optional real-mail testing reads only the ignored
`.env.smtp-e2e.local` file and runs with `bun run registry:test:smtp-e2e`; it is never required for
ordinary CI.
