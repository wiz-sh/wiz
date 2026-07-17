import type { RegistryTransport } from "./transport.ts";
import type {
    AccessTokenSummary,
    CreatedAccessToken,
    CreateTokenInput,
    CursorPage,
    RegistryRequestOptions,
} from "./types.ts";

export class RegistryTokensResource {
    constructor(private readonly transport: RegistryTransport) {}

    list(
        options: RegistryRequestOptions = {},
    ): Promise<CursorPage<AccessTokenSummary>> {
        return this.transport.request({
            path: "/v1/users/me/tokens",
            ...options,
        });
    }

    create(
        input: CreateTokenInput,
        options: RegistryRequestOptions = {},
    ): Promise<CreatedAccessToken> {
        return this.transport.request({
            method: "POST",
            path: "/v1/users/me/tokens",
            body: input,
            ...options,
        });
    }

    get(
        id: string,
        options: RegistryRequestOptions = {},
    ): Promise<AccessTokenSummary> {
        return this.transport.request({
            path: `/v1/users/me/tokens/${encodeURIComponent(id)}`,
            ...options,
        });
    }

    rename(
        id: string,
        name: string,
        options: RegistryRequestOptions = {},
    ): Promise<AccessTokenSummary> {
        return this.transport.request({
            method: "PATCH",
            path: `/v1/users/me/tokens/${encodeURIComponent(id)}`,
            body: { name },
            ...options,
        });
    }

    revoke(id: string, options: RegistryRequestOptions = {}): Promise<void> {
        return this.transport.request({
            method: "DELETE",
            path: `/v1/users/me/tokens/${encodeURIComponent(id)}`,
            ...options,
        });
    }
}
