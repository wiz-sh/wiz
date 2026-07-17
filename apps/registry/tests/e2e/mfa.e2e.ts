import { expect, test } from "bun:test";
import type { RegistryError } from "@wiz/registry-client";
import { generateTotp } from "../../src/security/totp.ts";
import { createVerifiedUser } from "./helpers.e2e.ts";

test("TOTP enrollment, MFA login, replay protection, recovery codes, and disablement", async () => {
    const user = await createVerifiedUser("mfa");

    const setup = await user.client.transport.request<{
        secret: string;
        uri: string;
    }>({
        method: "POST",
        path: "/v1/auth/totp/setup",
    });

    expect(setup.uri).toStartWith("otpauth://totp/");

    const enrollmentCode = await generateTotp(setup.secret, Date.now());

    const confirmed = await user.client.transport.request<{
        recoveryCodes: string[];
    }>({
        method: "POST",
        path: "/v1/auth/totp/confirm",
        body: { code: enrollmentCode.code },
    });

    expect(confirmed.recoveryCodes).toHaveLength(10);

    const login = await user.client.users.login({
        identifier: user.username,
        password: user.password,
    });

    expect(login.state).toBe("mfa_required");

    const code = await generateTotp(setup.secret, Date.now());

    const authenticated = await user.client.users.completeTotp(
        login.challengeId ?? "",
        code.code,
    );

    expect(authenticated.state).toBe("authenticated");
    expect(authenticated.token).toStartWith("wiz_pat_");

    const replayLogin = await user.client.users.login({
        identifier: user.username,
        password: user.password,
    });

    await expect(
        user.client.users.completeTotp(
            replayLogin.challengeId ?? "",
            code.code,
        ),
    ).rejects.toMatchObject({
        code: "TOTP_INVALID",
        status: 401,
    } satisfies Partial<RegistryError>);

    const recoveryLogin = await user.client.users.login({
        identifier: user.username,
        password: user.password,
    });

    const recovered = await user.client.transport.request<{
        state: string;
        token: string;
    }>({
        method: "POST",
        path: "/v1/auth/mfa/recovery",
        body: {
            challenge: recoveryLogin.challengeId,
            code: confirmed.recoveryCodes[0],
        },
    });

    expect(recovered.token).toStartWith("wiz_pat_");

    const reuseLogin = await user.client.users.login({
        identifier: user.username,
        password: user.password,
    });

    await expect(
        user.client.transport.request({
            method: "POST",
            path: "/v1/auth/mfa/recovery",
            body: {
                challenge: reuseLogin.challengeId,
                code: confirmed.recoveryCodes[0],
            },
        }),
    ).rejects.toMatchObject({
        code: "RECOVERY_CODE_INVALID",
    } satisfies Partial<RegistryError>);

    await user.client.transport.request({
        method: "DELETE",
        path: "/v1/auth/totp",
    });

    const passwordOnly = await user.client.users.login({
        identifier: user.username,
        password: user.password,
    });

    expect(passwordOnly.state).toBe("authenticated");
});
