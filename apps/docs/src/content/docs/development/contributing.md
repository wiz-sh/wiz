---
title: "Contributing"
description: "Follow Wiz repository conventions for Bun, strict TypeScript, tests, architecture boundaries, and shell safety."
---


Keep TypeScript strict, ESNext, four-space indented, double-quoted, and semicolon-terminated.
Use Bun and Biome only. Preserve package-manager behavior with a passing migration test before
removing old code. Compiler internals may evolve together, but consumers should import stable
entry points from package indexes. Add unit, integration, and end-to-end coverage proportional
to the semantic risk of every change.
