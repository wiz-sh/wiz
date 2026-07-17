import type { RegistryTransport } from "./transport.ts";
import type { PublishTransaction, RegistryRequestOptions } from "./types.ts";

function path(name: string, publishId?: string): string {
    const base = `/v1/packages/${encodeURIComponent(name)}/publishes`;

    return publishId === undefined
        ? base
        : `${base}/${encodeURIComponent(publishId)}`;
}

export class RegistryPublishingResource {
    constructor(private readonly transport: RegistryTransport) {}

    create(
        name: string,
        input: { version: string; integrity: string; size: number },
        options: RegistryRequestOptions = {},
    ): Promise<PublishTransaction> {
        return this.transport.request({
            method: "POST",
            path: path(name),
            body: input,
            ...options,
        });
    }

    upload(
        name: string,
        publishId: string,
        archive: Blob,
        options: RegistryRequestOptions = {},
    ): Promise<void> {
        return this.transport.request({
            method: "PUT",
            path: `${path(name, publishId)}/archive`,
            body: archive,
            headers: { "content-type": "application/octet-stream" },
            ...options,
        });
    }

    finalize(
        name: string,
        publishId: string,
        options: RegistryRequestOptions = {},
    ): Promise<PublishTransaction> {
        return this.transport.request({
            method: "POST",
            path: `${path(name, publishId)}/finalize`,
            ...options,
        });
    }

    get(
        name: string,
        publishId: string,
        options: RegistryRequestOptions = {},
    ): Promise<PublishTransaction> {
        return this.transport.request({
            path: path(name, publishId),
            ...options,
        });
    }
}
