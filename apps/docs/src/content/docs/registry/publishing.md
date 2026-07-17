---
title: "Publishing"
description: "Build, validate, upload, and finalize immutable package versions."
---

`wiz publish` discovers and validates `manifest.json`, selects the configured registry, builds a
deterministic archive, computes SHA-512 integrity, uploads it, finalizes the transaction, and waits
for publication.

```console
WIZ_TOKEN=wiz_pat_redacted wiz publish --access=public
```

The registry rejects mismatched names or versions, unresolved local dependencies, oversized or
malformed archives, absolute and duplicate paths, traversal, unsafe links, special files, archive
bombs, embedded Git credentials, and an existing immutable version. It records the original and
normalized manifest, file inventory, hashes, publisher, token identity, and provenance.

Filesystem storage accepts the bytes directly in development. An S3-compatible deployment can use
presigned uploads; authorization is rechecked when finalizing, so possession of an upload URL does
not grant publication rights.
