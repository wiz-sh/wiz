import type { RegistryTransport } from "./transport.ts";
import type { RegistryRequestOptions } from "./types.ts";

export interface PasskeyCredentialSummary {
    id: string;
    name: string;
    deviceType: string;
    backedUp: boolean;
    createdAt: string;
    lastUsedAt?: string;
}

export class RegistryWebAuthnResource {
    constructor(private readonly transport: RegistryTransport) {}

    registrationOptions(
        options: RegistryRequestOptions = {},
    ): Promise<Record<string, unknown>> {
        return this.transport.request({
            method: "POST",
            path: "/v1/auth/webauthn/registration/options",
            ...options,
        });
    }

    verifyRegistration(
        input: {
            challengeId: string;
            name?: string;
            response: Record<string, unknown>;
        },
        options: RegistryRequestOptions = {},
    ): Promise<PasskeyCredentialSummary> {
        return this.transport.request({
            method: "POST",
            path: "/v1/auth/webauthn/registration/verify",
            body: input,
            ...options,
        });
    }

    authenticationOptions(
        identifier?: string,
        options: RegistryRequestOptions = {},
    ): Promise<Record<string, unknown>> {
        return this.transport.request({
            method: "POST",
            path: "/v1/auth/webauthn/authentication/options",
            body: identifier === undefined ? {} : { identifier },
            ...options,
        });
    }

    verifyAuthentication(
        input: {
            challengeId: string;
            response: Record<string, unknown>;
        },
        options: RegistryRequestOptions = {},
    ): Promise<{ state: "authenticated"; token: string }> {
        return this.transport.request({
            method: "POST",
            path: "/v1/auth/webauthn/authentication/verify",
            body: input,
            ...options,
        });
    }

    list(
        options: RegistryRequestOptions = {},
    ): Promise<{ items: readonly PasskeyCredentialSummary[] }> {
        return this.transport.request({
            path: "/v1/users/me/webauthn-credentials",
            ...options,
        });
    }

    rename(
        id: string,
        name: string,
        options: RegistryRequestOptions = {},
    ): Promise<PasskeyCredentialSummary> {
        return this.transport.request({
            method: "PATCH",
            path: `/v1/users/me/webauthn-credentials/${encodeURIComponent(id)}`,
            body: { name },
            ...options,
        });
    }

    remove(id: string, options: RegistryRequestOptions = {}): Promise<void> {
        return this.transport.request({
            method: "DELETE",
            path: `/v1/users/me/webauthn-credentials/${encodeURIComponent(id)}`,
            ...options,
        });
    }
}
