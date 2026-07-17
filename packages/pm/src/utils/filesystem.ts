import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Replaces a file only after its complete contents have been written in the same directory. */
export async function atomicWrite(
    path: string,
    contents: string,
): Promise<void> {
    await mkdir(dirname(path), { recursive: true });

    const temporary = `${path}.tmp-${crypto.randomUUID()}`;

    await writeFile(temporary, contents, { mode: 0o600 });

    await rename(temporary, path);
}

export async function readDirectoryOrEmpty(path: string): Promise<string[]> {
    try {
        return await readdir(path);
    } catch {
        return [];
    }
}
