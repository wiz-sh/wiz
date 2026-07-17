import { expect, test } from "bun:test";
import { RegistryClient, RegistryError } from "@wiz/registry-client";
import {
    createVerifiedUser,
    packageArchive,
    registryUrl,
    unique,
} from "./helpers.e2e.ts";

test("signup, captured email verification, tokens, organizations, publishing, and privacy", async () => {
    const owner = await createVerifiedUser("owner");

    const stranger = await createVerifiedUser("stranger");

    const organizationName = unique("org").toLowerCase();

    const organization = await owner.client.organizations.create({
        name: organizationName,
        displayName: "Registry E2E Organization",
    });

    expect(organization.name).toBe(organizationName);

    const packageName = `@${owner.username}/${unique("private")}`;

    await owner.client.packages.create({
        name: packageName,
        visibility: "private",
        description: "Private E2E package",
    });

    const archive = await packageArchive(packageName, "1.0.0");

    const publish = await owner.client.publishing.create(packageName, {
        version: "1.0.0",
        integrity: archive.integrity,
        size: archive.bytes.byteLength,
    });

    await owner.client.publishing.upload(
        packageName,
        publish.id,
        new Blob([Uint8Array.from(archive.bytes)]),
    );

    const finalized = await owner.client.publishing.finalize(
        packageName,
        publish.id,
    );

    expect(finalized.state).toBe("published");

    const downloaded = await owner.client.downloads.archive(
        packageName,
        "1.0.0",
    );

    expect(downloaded).toEqual(archive.bytes);

    await expect(
        stranger.client.packages.get(packageName),
    ).rejects.toMatchObject({
        status: 404,
        code: "PACKAGE_NOT_FOUND",
    } satisfies Partial<RegistryError>);

    const grant = await owner.client.packages.grant(
        packageName,
        stranger.username,
        "read",
    );

    expect(grant.username).toBe(stranger.username);

    expect((await stranger.client.packages.get(packageName)).name).toBe(
        packageName,
    );

    const publicClient = new RegistryClient({ baseUrl: registryUrl });

    await expect(publicClient.packages.get(packageName)).rejects.toBeInstanceOf(
        RegistryError,
    );
});

test("OpenAPI and Scalar expose the typed registry surface", async () => {
    const specification = (await fetch(`${registryUrl}/openapi/json`).then(
        (response) => {
            expect(response.status).toBe(200);

            return response.json();
        },
    )) as {
        openapi?: string;
        paths?: Record<string, unknown>;
        components?: { securitySchemes?: Record<string, unknown> };
    };

    expect(specification.openapi?.startsWith("3.")).toBeTrue();
    expect(specification.paths?.["/v1/auth/signup"]).toBeDefined();
    expect(
        specification.paths?.["/v1/packages/{packageName}/publishes"],
    ).toBeDefined();
    expect(specification.components?.securitySchemes?.bearerAuth).toBeDefined();

    const scalar = await fetch(`${registryUrl}/openapi`).then((response) => {
        return response.text();
    });

    expect(scalar.toLowerCase()).toContain("scalar");
});
