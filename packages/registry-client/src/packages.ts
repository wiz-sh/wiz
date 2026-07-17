import type { RegistryTransport } from "./transport.ts";
import type {
    CursorPage,
    RegistryPackage,
    RegistryPackageVersion,
    RegistryRequestOptions,
} from "./types.ts";

function path(name: string): string {
    return `/v1/packages/${encodeURIComponent(name)}`;
}

export class RegistryPackagesResource {
    constructor(private readonly transport: RegistryTransport) {}

    get(
        name: string,
        options: RegistryRequestOptions = {},
    ): Promise<RegistryPackage> {
        return this.transport.request({ path: path(name), ...options });
    }

    create(
        input: {
            name: string;
            description?: string;
            visibility: "public" | "private";
        },
        options: RegistryRequestOptions = {},
    ): Promise<RegistryPackage> {
        return this.transport.request({
            method: "POST",
            path: "/v1/packages",
            body: input,
            ...options,
        });
    }

    versions(
        name: string,
        options: RegistryRequestOptions = {},
    ): Promise<CursorPage<RegistryPackageVersion>> {
        return this.transport.request({
            path: `${path(name)}/versions`,
            ...options,
        });
    }

    version(
        name: string,
        version: string,
        options: RegistryRequestOptions = {},
    ): Promise<RegistryPackageVersion> {
        return this.transport.request({
            path: `${path(name)}/versions/${encodeURIComponent(version)}`,
            ...options,
        });
    }

    setTag(
        name: string,
        tag: string,
        version: string,
        options: RegistryRequestOptions = {},
    ): Promise<{ tag: string; version: string }> {
        return this.transport.request({
            method: "PUT",
            path: `${path(name)}/dist-tags/${encodeURIComponent(tag)}`,
            body: { version },
            ...options,
        });
    }

    deprecate(
        name: string,
        version: string,
        message: string,
        options: RegistryRequestOptions = {},
    ): Promise<{ version: string; message: string }> {
        return this.transport.request({
            method: "POST",
            path: `${path(name)}/versions/${encodeURIComponent(version)}/deprecate`,
            body: { message },
            ...options,
        });
    }

    grant(
        name: string,
        username: string,
        permission: "read" | "triage" | "publish" | "manage" | "admin",
        options: RegistryRequestOptions = {},
    ): Promise<{ id: string; username: string; permission: string }> {
        return this.transport.request({
            method: "POST",
            path: `${path(name)}/access`,
            body: { username, permission },
            ...options,
        });
    }
}
