import { RegistryAdministrationResource } from "./administration.ts";
import { RegistryDownloadsResource } from "./downloads.ts";
import { RegistryOrganizationsResource } from "./organizations.ts";
import { RegistryPackagesResource } from "./packages.ts";
import { RegistryPublishingResource } from "./publishing.ts";
import { RegistrySearchResource } from "./search.ts";
import { RegistryTokensResource } from "./tokens.ts";
import {
    RegistryTransport,
    type RegistryTransportOptions,
} from "./transport.ts";
import type {
    AccessTokenSummary,
    CursorPage,
    PublishTransaction,
    RegistryOrganization,
    RegistryPackage,
    RegistryPackageSearch,
    RegistryPackageVersion,
    RegistryRequestOptions,
    RegistryUser,
} from "./types.ts";
import { RegistryUsersResource } from "./users.ts";
import { RegistryWebAuthnResource } from "./webauthn.ts";
import { RegistryWebhooksResource } from "./webhooks.ts";

function packagePath(name: string): string {
    return encodeURIComponent(name);
}

/** Typed facade over the versioned Wiz registry HTTP API. */
export class RegistryClient {
    readonly transport: RegistryTransport;

    readonly users: RegistryUsersResource;

    readonly tokensResource: RegistryTokensResource;

    readonly packages: RegistryPackagesResource;

    readonly publishing: RegistryPublishingResource;

    readonly downloads: RegistryDownloadsResource;

    readonly searchResource: RegistrySearchResource;

    readonly organizations: RegistryOrganizationsResource;

    readonly webauthn: RegistryWebAuthnResource;

    readonly webhooks: RegistryWebhooksResource;

    readonly administration: RegistryAdministrationResource;

    constructor(options: RegistryTransportOptions) {
        this.transport = new RegistryTransport(options);

        this.users = new RegistryUsersResource(this.transport);

        this.tokensResource = new RegistryTokensResource(this.transport);

        this.packages = new RegistryPackagesResource(this.transport);

        this.publishing = new RegistryPublishingResource(this.transport);

        this.downloads = new RegistryDownloadsResource(this.transport);

        this.searchResource = new RegistrySearchResource(this.transport);

        this.organizations = new RegistryOrganizationsResource(this.transport);

        this.webauthn = new RegistryWebAuthnResource(this.transport);

        this.webhooks = new RegistryWebhooksResource(this.transport);

        this.administration = new RegistryAdministrationResource(
            this.transport,
        );
    }

    health(options: RegistryRequestOptions = {}): Promise<{ status: string }> {
        return this.transport.request({ path: "/health", ...options });
    }

    whoami(options: RegistryRequestOptions = {}): Promise<RegistryUser> {
        return this.transport.request({ path: "/v1/users/me", ...options });
    }

    package(
        name: string,
        options: RegistryRequestOptions = {},
    ): Promise<RegistryPackage> {
        return this.transport.request({
            path: `/v1/packages/${packagePath(name)}`,
            ...options,
        });
    }

    version(
        name: string,
        version: string,
        options: RegistryRequestOptions = {},
    ): Promise<RegistryPackageVersion> {
        return this.transport.request({
            path: `/v1/packages/${packagePath(name)}/versions/${encodeURIComponent(version)}`,
            ...options,
        });
    }

    search(
        input: string | RegistryPackageSearch,
        cursorOrOptions?: string | RegistryRequestOptions,
        options: RegistryRequestOptions = {},
    ): Promise<CursorPage<RegistryPackage>> {
        const request =
            typeof cursorOrOptions === "object" ? cursorOrOptions : options;

        const search = typeof input === "string" ? { query: input } : input;

        const parameters = new URLSearchParams({ q: search.query });

        for (const [name, value] of Object.entries(search)) {
            if (name === "query" || value === undefined) {
                continue;
            }

            parameters.set(name, String(value));
        }

        if (typeof cursorOrOptions === "string") {
            parameters.set("cursor", cursorOrOptions);
        }

        return this.transport.request({
            path: `/v1/search?${parameters}`,
            ...request,
        });
    }

    download(
        name: string,
        version: string,
        options: RegistryRequestOptions = {},
    ): Promise<Uint8Array> {
        return this.transport.request({
            path: `/v1/packages/${packagePath(name)}/versions/${encodeURIComponent(version)}/archive`,
            response: "bytes",
            ...options,
        });
    }

    createPublish(
        name: string,
        input: { version: string; integrity: string; size: number },
        options: RegistryRequestOptions = {},
    ): Promise<PublishTransaction> {
        return this.transport.request({
            method: "POST",
            path: `/v1/packages/${packagePath(name)}/publishes`,
            body: input,
            ...options,
        });
    }

    uploadPublish(
        name: string,
        publishId: string,
        archive: Blob,
        options: RegistryRequestOptions = {},
    ): Promise<void> {
        return this.transport.request({
            method: "PUT",
            path: `/v1/packages/${packagePath(name)}/publishes/${encodeURIComponent(publishId)}/archive`,
            body: archive,
            headers: { "content-type": "application/octet-stream" },
            ...options,
        });
    }

    finalizePublish(
        name: string,
        publishId: string,
        options: RegistryRequestOptions = {},
    ): Promise<PublishTransaction> {
        return this.transport.request({
            method: "POST",
            path: `/v1/packages/${packagePath(name)}/publishes/${encodeURIComponent(publishId)}/finalize`,
            ...options,
        });
    }

    createOrganization(
        input: { name: string; displayName: string },
        options: RegistryRequestOptions = {},
    ): Promise<RegistryOrganization> {
        return this.transport.request({
            method: "POST",
            path: "/v1/orgs",
            body: input,
            ...options,
        });
    }

    tokens(
        options: RegistryRequestOptions = {},
    ): Promise<CursorPage<AccessTokenSummary>> {
        return this.transport.request({
            path: "/v1/users/me/tokens",
            ...options,
        });
    }
}
