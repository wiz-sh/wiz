import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ArchiveStorage } from "./types.ts";
import { safeStorageKey } from "./types.ts";

export class FilesystemArchiveStorage implements ArchiveStorage {
    readonly driver = "filesystem" as const;

    readonly root: string;

    constructor(root: string) {
        this.root = resolve(root);
    }

    private path(key: string): string {
        return resolve(this.root, safeStorageKey(key));
    }

    async put(key: string, content: Uint8Array): Promise<void> {
        const path = this.path(key);

        await mkdir(dirname(path), { recursive: true });

        await writeFile(path, content, { flag: "wx", mode: 0o600 });
    }

    async get(key: string): Promise<Uint8Array> {
        return readFile(this.path(key));
    }

    async exists(key: string): Promise<boolean> {
        try {
            await stat(this.path(key));

            return true;
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                return false;
            }

            throw err;
        }
    }

    async remove(key: string): Promise<void> {
        await rm(this.path(key), { force: true });
    }
}
