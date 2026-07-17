import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { RegistryError } from "@wiz/registry-client";
import { createVerifiedUser, packageArchive, unique } from "./helpers.e2e.ts";

test("immutable versions and archive traversal are rejected", async () => {
    const owner = await createVerifiedUser("security");

    const packageName = `@${owner.username}/${unique("archive")}`;

    await owner.client.packages.create({
        name: packageName,
        visibility: "public",
    });

    const archive = await packageArchive(packageName, "1.0.0");

    const first = await owner.client.publishing.create(packageName, {
        version: "1.0.0",
        integrity: archive.integrity,
        size: archive.bytes.byteLength,
    });

    await owner.client.publishing.upload(
        packageName,
        first.id,
        new Blob([Uint8Array.from(archive.bytes)]),
    );

    expect(
        (await owner.client.publishing.finalize(packageName, first.id)).state,
    ).toBe("published");

    await expect(
        owner.client.publishing.create(packageName, {
            version: "1.0.0",
            integrity: archive.integrity,
            size: archive.bytes.byteLength,
        }),
    ).rejects.toMatchObject({
        code: "PACKAGE_VERSION_EXISTS",
        status: 409,
    } satisfies Partial<RegistryError>);

    const unsafe = await new Bun.Archive(
        {
            "../escape": "forbidden",
            "manifest.json": JSON.stringify({
                name: packageName,
                version: "2.0.0",
                dependencies: {},
            }),
        },
        { compress: "gzip" },
    ).bytes();

    const unsafePublish = await owner.client.publishing.create(packageName, {
        version: "2.0.0",
        integrity: `sha512-${createHash("sha512").update(unsafe).digest("base64")}`,
        size: unsafe.byteLength,
    });

    await owner.client.publishing.upload(
        packageName,
        unsafePublish.id,
        new Blob([Uint8Array.from(unsafe)]),
    );

    await expect(
        owner.client.publishing.finalize(packageName, unsafePublish.id),
    ).rejects.toMatchObject({
        code: "PACKAGE_ARCHIVE_INVALID",
        status: 400,
    } satisfies Partial<RegistryError>);
});
