---
title: "Organizations and teams"
description: "Manage organization roles, invitations, teams, policies, and audit history."
---

Organizations support `owner`, `admin`, `maintainer`, `member`, `billing`, and `viewer` roles.
Invitations can target a username or email and expire. Teams group members and receive per-package
permissions without making a package public.

Policies control default visibility, required MFA for publishing, and token lifetime restrictions.
The final owner cannot leave or be removed. Membership, team, policy, publication, transfer, token,
and security changes produce append-only audit events without storing secrets.
