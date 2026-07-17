import type { RegistryTransport } from "./transport.ts";
import type {
    RegistryLoginResult,
    RegistryRequestOptions,
    RegistryUser,
} from "./types.ts";

export class RegistryUsersResource {
    constructor(private readonly transport: RegistryTransport) {}

    signup(
        input: { username: string; email: string; password: string },
        options: RegistryRequestOptions = {},
    ): Promise<RegistryUser> {
        return this.transport.request({
            method: "POST",
            path: "/v1/auth/signup",
            body: input,
            ...options,
        });
    }

    login(
        input: { identifier: string; password: string },
        options: RegistryRequestOptions = {},
    ): Promise<RegistryLoginResult> {
        return this.transport.request({
            method: "POST",
            path: "/v1/auth/login",
            body: input,
            ...options,
        });
    }

    verifyEmail(
        token: string,
        options: RegistryRequestOptions = {},
    ): Promise<{ verified: true }> {
        return this.transport.request({
            method: "POST",
            path: "/v1/auth/email/verify",
            body: { token },
            ...options,
        });
    }

    completeTotp(
        challenge: string,
        code: string,
        options: RegistryRequestOptions = {},
    ): Promise<RegistryLoginResult> {
        return this.transport.request({
            method: "POST",
            path: "/v1/auth/mfa/totp",
            body: { challenge, code },
            ...options,
        });
    }

    completeRecoveryCode(
        challenge: string,
        code: string,
        options: RegistryRequestOptions = {},
    ): Promise<RegistryLoginResult> {
        return this.transport.request({
            method: "POST",
            path: "/v1/auth/mfa/recovery",
            body: { challenge, code },
            ...options,
        });
    }

    resendVerification(
        identifier: string,
        options: RegistryRequestOptions = {},
    ): Promise<{ accepted: true }> {
        return this.transport.request({
            method: "POST",
            path: "/v1/auth/email/resend",
            body: { identifier },
            ...options,
        });
    }

    requestPasswordReset(
        identifier: string,
        options: RegistryRequestOptions = {},
    ): Promise<{ accepted: true }> {
        return this.transport.request({
            method: "POST",
            path: "/v1/auth/password/reset/request",
            body: { identifier },
            ...options,
        });
    }

    confirmPasswordReset(
        token: string,
        password: string,
        options: RegistryRequestOptions = {},
    ): Promise<{ reset: true }> {
        return this.transport.request({
            method: "POST",
            path: "/v1/auth/password/reset/confirm",
            body: { token, password },
            ...options,
        });
    }

    beginDeviceAuthorization(options: RegistryRequestOptions = {}): Promise<{
        deviceCode: string;
        userCode: string;
        verificationUri: string;
        expiresAt: string;
        interval: number;
    }> {
        return this.transport.request({
            method: "POST",
            path: "/v1/auth/device",
            ...options,
        });
    }

    exchangeDeviceCode(
        deviceCode: string,
        options: RegistryRequestOptions = {},
    ): Promise<
        | { state: "authorization_pending" }
        | { state: "authenticated"; token: string }
    > {
        return this.transport.request({
            method: "POST",
            path: "/v1/auth/device/token",
            body: { deviceCode },
            ...options,
        });
    }

    me(options: RegistryRequestOptions = {}): Promise<RegistryUser> {
        return this.transport.request({ path: "/v1/users/me", ...options });
    }
}
