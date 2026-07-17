---
title: "Archive storage"
description: "Choose filesystem or S3-compatible immutable archive storage."
---

`STORAGE_DRIVER=filesystem` is suitable for development and single-node installations. Set
`STORAGE_PATH` to a persistent volume owned by the non-root registry user. Back it up together with
PostgreSQL so metadata and bytes remain consistent.

Use `STORAGE_DRIVER=s3` for multi-instance production deployments and configure `S3_ENDPOINT`,
`S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`. The bucket should be
private; clients download through authorized registry routes or short-lived signed URLs. Enable
bucket versioning and lifecycle rules for incomplete publish uploads, not published versions.
