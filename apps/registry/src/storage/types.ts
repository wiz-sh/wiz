export interface ArchiveStorage {
    readonly driver: "filesystem" | "s3";

    put(key: string, content: Uint8Array): Promise<void>;

    get(key: string): Promise<Uint8Array>;

    exists(key: string): Promise<boolean>;

    remove(key: string): Promise<void>;

    presignPut?(key: string, expiresInSeconds: number): Promise<string>;
}

export function safeStorageKey(value: string): string {
    if (
        value.length === 0 ||
        value.startsWith("/") ||
        value.includes("\\") ||
        value.split("/").some((segment) => {
            return segment === "" || segment === "." || segment === "..";
        })
    ) {
        throw new Error("Unsafe storage key");
    }

    return value;
}
