import { RegistryHttpError } from "../middleware/errors.ts";

const blockSize = 512;
const maximumArchiveSize = 25 * 1024 * 1024;
const maximumExtractedSize = 100 * 1024 * 1024;
const maximumFiles = 10_000;

export interface ValidatedArchiveEntry {
    path: string;
    size: number;
    mode: number;
    integrity: string;
}

export interface ValidatedArchive {
    manifest: Readonly<Record<string, unknown>>;
    entries: readonly ValidatedArchiveEntry[];
}

function parseOctal(value: Uint8Array): number {
    const text = new TextDecoder()
        .decode(value)
        .replaceAll("\u0000", "")
        .trim();

    return text === "" ? 0 : Number.parseInt(text, 8);
}

function field(header: Uint8Array, start: number, length: number): string {
    return new TextDecoder()
        .decode(header.slice(start, start + length))
        .replace(/\0.*$/, "")
        .trim();
}

function safeArchivePath(path: string): boolean {
    return (
        path.length > 0 &&
        path.length <= 512 &&
        !path.startsWith("/") &&
        !path.includes("\\") &&
        !path.includes("\u0000") &&
        !path.split("/").some((segment) => {
            return segment === "" || segment === "." || segment === "..";
        })
    );
}

async function integrity(content: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest(
        "SHA-512",
        Uint8Array.from(content),
    );

    return `sha512-${Buffer.from(digest).toString("base64")}`;
}

/** Parses tar headers directly so links and special files cannot hide from extraction APIs. */
export async function validatePackageArchive(
    bytes: Uint8Array,
    expectedName: string,
    expectedVersion: string,
): Promise<ValidatedArchive> {
    if (bytes.byteLength === 0 || bytes.byteLength > maximumArchiveSize) {
        throw new RegistryHttpError(
            "PACKAGE_ARCHIVE_TOO_LARGE",
            413,
            `Archive must contain between 1 and ${maximumArchiveSize} bytes.`,
        );
    }

    let tarBytes = bytes;

    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        try {
            tarBytes = Bun.gunzipSync(Uint8Array.from(bytes));
        } catch {
            throw new RegistryHttpError(
                "PACKAGE_ARCHIVE_INVALID",
                400,
                "Archive gzip stream is malformed.",
            );
        }
    }

    if (tarBytes.byteLength > maximumExtractedSize + maximumFiles * blockSize) {
        throw new RegistryHttpError(
            "PACKAGE_ARCHIVE_TOO_LARGE",
            413,
            "Expanded archive exceeds the configured size limit.",
        );
    }

    const entries: ValidatedArchiveEntry[] = [];

    const seen = new Set<string>();

    let extractedSize = 0;

    let manifest: Readonly<Record<string, unknown>> | undefined;

    for (let offset = 0; offset + blockSize <= tarBytes.length; ) {
        const header = tarBytes.slice(offset, offset + blockSize);

        if (header.every((value) => value === 0)) {
            break;
        }

        const name = field(header, 0, 100);

        const prefix = field(header, 345, 155);

        const path = prefix === "" ? name : `${prefix}/${name}`;

        const mode = parseOctal(header.slice(100, 108));

        const size = parseOctal(header.slice(124, 136));

        const type = String.fromCharCode(header[156] ?? 0);

        const dataStart = offset + blockSize;

        const next = dataStart + Math.ceil(size / blockSize) * blockSize;

        if (!safeArchivePath(path) || next > tarBytes.length) {
            throw new RegistryHttpError(
                "PACKAGE_ARCHIVE_INVALID",
                400,
                `Archive contains an unsafe or truncated path: ${path}`,
            );
        }

        if (seen.has(path)) {
            throw new RegistryHttpError(
                "PACKAGE_ARCHIVE_INVALID",
                400,
                `Archive contains a duplicate path: ${path}`,
            );
        }

        seen.add(path);

        if (!["\u0000", "0", "5"].includes(type)) {
            throw new RegistryHttpError(
                "PACKAGE_ARCHIVE_INVALID",
                400,
                `Archive links and special files are forbidden: ${path}`,
            );
        }

        if ((mode & 0o6000) !== 0) {
            throw new RegistryHttpError(
                "PACKAGE_ARCHIVE_INVALID",
                400,
                `Archive setuid and setgid bits are forbidden: ${path}`,
            );
        }

        if (type !== "5") {
            const content = tarBytes.slice(dataStart, dataStart + size);

            extractedSize += size;

            if (
                extractedSize > maximumExtractedSize ||
                entries.length >= maximumFiles
            ) {
                throw new RegistryHttpError(
                    "PACKAGE_ARCHIVE_TOO_LARGE",
                    413,
                    "Archive exceeds the extracted size or file-count limit.",
                );
            }

            entries.push({
                path,
                size,
                mode,
                integrity: await integrity(content),
            });

            if (path === "manifest.json") {
                try {
                    manifest = JSON.parse(
                        new TextDecoder().decode(content),
                    ) as Readonly<Record<string, unknown>>;
                } catch {
                    throw new RegistryHttpError(
                        "PACKAGE_ARCHIVE_INVALID",
                        400,
                        "manifest.json is not valid JSON.",
                    );
                }
            }
        }

        offset = next;
    }

    if (manifest === undefined) {
        throw new RegistryHttpError(
            "PACKAGE_ARCHIVE_INVALID",
            400,
            "Archive must contain manifest.json at its root.",
        );
    }

    if (
        manifest.name !== expectedName ||
        manifest.version !== expectedVersion
    ) {
        throw new RegistryHttpError(
            "PACKAGE_ARCHIVE_INVALID",
            400,
            "Archive manifest name and version must match the publish transaction.",
        );
    }

    const dependencies = manifest.dependencies;

    if (
        dependencies !== null &&
        typeof dependencies === "object" &&
        !Array.isArray(dependencies) &&
        Object.values(dependencies).some((dependency) => {
            return (
                dependency !== null &&
                typeof dependency === "object" &&
                "path" in dependency
            );
        })
    ) {
        throw new RegistryHttpError(
            "PACKAGE_ARCHIVE_INVALID",
            400,
            "Published packages cannot contain unresolved local dependencies.",
        );
    }

    if (JSON.stringify(manifest).match(/https?:\/\/[^/\s:@]+:[^/\s@]+@/)) {
        throw new RegistryHttpError(
            "PACKAGE_ARCHIVE_INVALID",
            400,
            "Manifest contains embedded URL credentials.",
        );
    }

    return { manifest, entries };
}

export async function archiveIntegrity(bytes: Uint8Array): Promise<string> {
    return integrity(bytes);
}
