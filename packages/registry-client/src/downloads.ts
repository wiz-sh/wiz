import type { RegistryTransport } from "./transport.ts";
import type { RegistryRequestOptions } from "./types.ts";

export class RegistryDownloadsResource {
    constructor(private readonly transport: RegistryTransport) {}

    archive(
        name: string,
        version: string,
        options: RegistryRequestOptions = {},
    ): Promise<Uint8Array> {
        return this.transport.request({
            path: `/v1/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/archive`,
            response: "bytes",
            ...options,
        });
    }
}
