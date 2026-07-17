import type { ArchiveStorage } from "./types.ts";
import { safeStorageKey } from "./types.ts";

export interface S3ArchiveStorageOptions {
    endpoint?: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
}

export class S3ArchiveStorage implements ArchiveStorage {
    readonly driver = "s3" as const;

    private readonly client: Bun.S3Client;

    constructor(options: S3ArchiveStorageOptions) {
        this.client = new Bun.S3Client({
            region: options.region,
            bucket: options.bucket,
            accessKeyId: options.accessKeyId,
            secretAccessKey: options.secretAccessKey,
            ...(options.endpoint === undefined
                ? {}
                : { endpoint: options.endpoint }),
        });
    }

    async put(key: string, content: Uint8Array): Promise<void> {
        await this.client.write(safeStorageKey(key), content, {
            type: "application/octet-stream",
        });
    }

    async get(key: string): Promise<Uint8Array> {
        return this.client.file(safeStorageKey(key)).bytes();
    }

    async exists(key: string): Promise<boolean> {
        return this.client.exists(safeStorageKey(key));
    }

    async remove(key: string): Promise<void> {
        await this.client.delete(safeStorageKey(key));
    }

    async presignPut(key: string, expiresInSeconds: number): Promise<string> {
        return this.client.presign(safeStorageKey(key), {
            method: "PUT",
            expiresIn: expiresInSeconds,
        });
    }
}
