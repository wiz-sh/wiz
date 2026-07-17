import { expect, test } from "bun:test";
import { RegistryClient, type RegistryError } from "@wiz/registry-client";
import {
    createVerifiedUser,
    emailToken,
    packageArchive,
    registryUrl,
    unique,
} from "./helpers.e2e.ts";

test("verification and password-reset tokens are captured and single-use", async () => {
    const username = unique("password").toLowerCase();

    const email = `${username}@registry.test.localhost`;

    const originalPassword = `Initial-${crypto.randomUUID()}-Password!`;

    const replacementPassword = `Replacement-${crypto.randomUUID()}-Password!`;

    const client = new RegistryClient({ baseUrl: registryUrl });

    await client.users.signup({
        username,
        email,
        password: originalPassword,
    });

    const verification = await emailToken(
        email,
        "Verify your Wiz Registry email",
    );

    await client.users.verifyEmail(verification);

    await expect(client.users.verifyEmail(verification)).rejects.toMatchObject({
        status: 400,
        code: "AUTHENTICATION_FAILED",
    } satisfies Partial<RegistryError>);

    await client.users.requestPasswordReset(username);

    const reset = await emailToken(email, "Reset your Wiz Registry password");

    await client.users.confirmPasswordReset(reset, replacementPassword);

    await expect(
        client.users.confirmPasswordReset(reset, replacementPassword),
    ).rejects.toMatchObject({
        status: 400,
        code: "AUTHENTICATION_FAILED",
    } satisfies Partial<RegistryError>);

    await expect(
        client.users.login({
            identifier: username,
            password: originalPassword,
        }),
    ).rejects.toMatchObject({
        status: 401,
        code: "AUTHENTICATION_FAILED",
    } satisfies Partial<RegistryError>);

    expect(
        (
            await client.users.login({
                identifier: username,
                password: replacementPassword,
            })
        ).state,
    ).toBe("authenticated");
});

test("browser sessions require CSRF protection for mutations", async () => {
    const user = await createVerifiedUser("session");

    const response = await fetch(`${registryUrl}/v1/auth/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            identifier: user.username,
            password: user.password,
        }),
    });

    expect(response.status).toBe(200);

    const session = (await response.json()) as {
        csrfToken: string;
    };

    const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];

    expect(cookie).toStartWith("wiz_session=");

    const missingCsrf = await fetch(`${registryUrl}/v1/users/me`, {
        method: "PATCH",
        headers: {
            cookie: cookie ?? "",
            "content-type": "application/json",
        },
        body: JSON.stringify({ displayName: "Session User" }),
    });

    expect(missingCsrf.status).toBe(403);

    const updated = await fetch(`${registryUrl}/v1/users/me`, {
        method: "PATCH",
        headers: {
            cookie: cookie ?? "",
            "content-type": "application/json",
            "x-csrf-token": session.csrfToken,
        },
        body: JSON.stringify({ displayName: "Session User" }),
    });

    expect(updated.status).toBe(200);
});

test("device authorization is pending, approvable, single-use, and revocable", async () => {
    const user = await createVerifiedUser("device");

    const anonymous = new RegistryClient({ baseUrl: registryUrl });

    const device = await anonymous.users.beginDeviceAuthorization();

    expect(await anonymous.users.exchangeDeviceCode(device.deviceCode)).toEqual(
        { state: "authorization_pending" },
    );

    await user.client.transport.request({
        method: "POST",
        path: "/v1/auth/device/authorize",
        body: { userCode: device.userCode },
    });

    const authorized = await anonymous.users.exchangeDeviceCode(
        device.deviceCode,
    );

    expect(authorized.state).toBe("authenticated");

    await expect(
        anonymous.users.exchangeDeviceCode(device.deviceCode),
    ).rejects.toMatchObject({
        status: 400,
        code: "AUTHENTICATION_FAILED",
    } satisfies Partial<RegistryError>);

    if (authorized.state !== "authenticated") {
        throw new Error("Device authorization did not produce a token");
    }

    const authorizedClient = new RegistryClient({
        baseUrl: registryUrl,
        token: authorized.token,
    });

    expect((await authorizedClient.whoami()).username).toBe(user.username);

    await authorizedClient.transport.request({
        method: "POST",
        path: "/v1/auth/logout",
    });

    await expect(authorizedClient.whoami()).rejects.toMatchObject({
        status: 401,
        code: "TOKEN_REVOKED",
    } satisfies Partial<RegistryError>);
});

test("token scopes and package restrictions prevent privilege expansion", async () => {
    const user = await createVerifiedUser("scope");

    const allowedPackage = `@${user.username}/${unique("allowed")}`;

    const deniedPackage = `@${user.username}/${unique("denied")}`;

    const restricted = await user.client.tokensResource.create({
        name: "Restricted automation",
        scopes: ["packages:read", "packages:write"],
        type: "automation",
        packages: [allowedPackage],
    });

    const restrictedClient = new RegistryClient({
        baseUrl: registryUrl,
        token: restricted.token,
    });

    await restrictedClient.packages.create({
        name: allowedPackage,
        visibility: "private",
    });

    await expect(
        restrictedClient.packages.create({
            name: deniedPackage,
            visibility: "private",
        }),
    ).rejects.toMatchObject({
        status: 403,
        code: "INSUFFICIENT_PERMISSION",
    } satisfies Partial<RegistryError>);

    await expect(
        restrictedClient.tokensResource.create({
            name: "Escalated",
            scopes: ["orgs:write"],
            type: "personal",
        }),
    ).rejects.toMatchObject({
        status: 403,
        code: "INSUFFICIENT_PERMISSION",
    } satisfies Partial<RegistryError>);
});

test("organization invitations, teams, grants, and final-owner protection work", async () => {
    const owner = await createVerifiedUser("team-owner");

    const member = await createVerifiedUser("team-member");

    const organization = unique("organization").toLowerCase();

    await owner.client.organizations.create({
        name: organization,
        displayName: "Team E2E",
    });

    const invitation = await owner.client.organizations.invite(organization, {
        username: member.username,
        role: "member",
    });

    await member.client.transport.request({
        method: "POST",
        path: `/v1/users/me/invitations/${invitation.id}/accept`,
    });

    const team = await owner.client.transport.request<{ id: string }>({
        method: "POST",
        path: `/v1/orgs/${encodeURIComponent(organization)}/teams`,
        body: { name: "release" },
    });

    expect(team.id).toBeString();

    await owner.client.transport.request({
        method: "PUT",
        path: `/v1/orgs/${encodeURIComponent(organization)}/teams/release/members/${encodeURIComponent(member.username)}`,
    });

    const packageName = `@${organization}/${unique("tool")}`;

    await owner.client.packages.create({
        name: packageName,
        visibility: "private",
    });

    const archive = await packageArchive(packageName, "1.0.0");

    const publication = await owner.client.publishing.create(packageName, {
        version: "1.0.0",
        integrity: archive.integrity,
        size: archive.bytes.byteLength,
    });

    await owner.client.publishing.upload(
        packageName,
        publication.id,
        new Blob([archive.bytes]),
    );

    await owner.client.publishing.finalize(packageName, publication.id);

    await owner.client.transport.request({
        method: "PUT",
        path: `/v1/orgs/${encodeURIComponent(organization)}/teams/release/packages/${encodeURIComponent(packageName)}`,
        body: { permission: "read" },
    });

    const teamPackages = await member.client.transport.request<{
        items: readonly { package: string; permission: string }[];
    }>({
        path: `/v1/orgs/${encodeURIComponent(organization)}/teams/release/packages`,
    });

    expect(teamPackages.items).toContainEqual({
        package: packageName,
        permission: "read",
    });

    await expect(
        owner.client.transport.request({
            method: "DELETE",
            path: `/v1/orgs/${encodeURIComponent(organization)}/members/${encodeURIComponent(owner.username)}`,
        }),
    ).rejects.toMatchObject({
        status: 409,
        code: "LAST_ORG_OWNER",
    } satisfies Partial<RegistryError>);
});
