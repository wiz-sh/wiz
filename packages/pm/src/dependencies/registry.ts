import { createHash } from "node:crypto";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
    loadUserRegistryConfig,
    type ProjectRegistryConfig,
    RegistryClient,
    type RegistryPackageVersion,
    selectRegistry,
} from "@wiz/registry-client";
import type { RegistryDependencySpec } from "../types.ts";
import { WizError } from "../utils/errors.ts";
import { storePath } from "./store.ts";

export interface ResolvedRegistryPackage {
    registry: string;
    name: string;
    version: string;
    archiveUrl: string;
    integrity: string;
    size: number;
    manifest: Readonly<Record<string, unknown>>;
    token?: string;
}

export async function registryPackageFromLock(input: {
    registry: string;
    name: string;
    version: string;
    archiveUrl: string;
    integrity: string;
    size: number;
}): Promise<ResolvedRegistryPackage> {
    const userConfig = await loadUserRegistryConfig();

    const matchingEntry = Object.values(userConfig.registries).find((entry) => {
        return entry.url === input.registry;
    });

    const token = process.env.WIZ_TOKEN ?? matchingEntry?.token;

    return {
        registry: input.registry,
        name: input.name,
        version: input.version,
        archiveUrl: input.archiveUrl,
        integrity: input.integrity,
        size: input.size,
        manifest: {},
        ...(token === undefined ? {} : { token }),
    };
}

interface SemanticVersion {
    major: number;
    minor: number;
    patch: number;
    prerelease?: string;
}

function parseVersion(value: string): SemanticVersion | undefined {
    const match =
        /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
            value,
        );

    if (match === null) {
        return undefined;
    }

    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        ...(match[4] === undefined ? {} : { prerelease: match[4] }),
    };
}

function compareVersions(
    left: SemanticVersion,
    right: SemanticVersion,
): number {
    return (
        left.major - right.major ||
        left.minor - right.minor ||
        left.patch - right.patch ||
        (left.prerelease === undefined
            ? right.prerelease === undefined
                ? 0
                : 1
            : right.prerelease === undefined
              ? -1
              : left.prerelease.localeCompare(right.prerelease))
    );
}

function satisfies(version: SemanticVersion, range: string): boolean {
    if (range === "*" || range === "latest") {
        return version.prerelease === undefined;
    }

    const operator = range[0];

    const requested = parseVersion(
        operator === "^" || operator === "~" ? range.slice(1) : range,
    );

    if (requested === undefined) {
        throw new WizError(`Unsupported semantic version range: ${range}`);
    }

    const comparison = compareVersions(version, requested);

    if (operator === "^") {
        const ceiling =
            requested.major > 0
                ? { major: requested.major + 1, minor: 0, patch: 0 }
                : requested.minor > 0
                  ? { major: 0, minor: requested.minor + 1, patch: 0 }
                  : { major: 0, minor: 0, patch: requested.patch + 1 };

        return comparison >= 0 && compareVersions(version, ceiling) < 0;
    }

    if (operator === "~") {
        return (
            comparison >= 0 &&
            version.major === requested.major &&
            version.minor === requested.minor
        );
    }

    return comparison === 0;
}

function selectVersion(
    versions: readonly RegistryPackageVersion[],
    range: string,
): RegistryPackageVersion {
    const compatible = versions
        .map((record) => {
            return { record, parsed: parseVersion(record.version) };
        })
        .filter(
            (
                entry,
            ): entry is {
                record: RegistryPackageVersion;
                parsed: SemanticVersion;
            } => {
                return (
                    entry.parsed !== undefined && satisfies(entry.parsed, range)
                );
            },
        )
        .toSorted((left, right) => {
            return compareVersions(right.parsed, left.parsed);
        });

    const selected = compatible[0]?.record;

    if (selected === undefined) {
        throw new WizError(`No registry version satisfies ${range}`);
    }

    return selected;
}

export async function resolveRegistryPackage(
    name: string,
    spec: RegistryDependencySpec,
    project?: ProjectRegistryConfig,
): Promise<ResolvedRegistryPackage> {
    const userConfig = await loadUserRegistryConfig();

    const selectedRegistry = selectRegistry(name, userConfig, {
        ...(spec.registry === undefined ? {} : { registry: spec.registry }),
        ...(project === undefined ? {} : { project }),
    });

    const client = new RegistryClient({
        baseUrl: selectedRegistry.url,
        ...(selectedRegistry.token === undefined
            ? {}
            : { token: selectedRegistry.token }),
    });

    const versions = await client.packages.versions(name);

    const selected = selectVersion(versions.items, spec.version);

    return {
        registry: selectedRegistry.url,
        name,
        version: selected.version,
        archiveUrl: selected.archiveUrl,
        integrity: selected.integrity,
        size: selected.archiveSize,
        manifest: selected.manifest,
        ...(selectedRegistry.token === undefined
            ? {}
            : { token: selectedRegistry.token }),
    };
}

function digest(bytes: Uint8Array): string {
    return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

function safeArchiveEntries(entries: ReadonlyMap<string, File>): void {
    if (entries.size === 0 || entries.size > 10_000) {
        throw new WizError("Registry archive has an invalid file count");
    }

    let size = 0;

    for (const [path, file] of entries) {
        if (
            path.startsWith("/") ||
            path.includes("\\") ||
            path.split("/").some((segment) => {
                return segment === "" || segment === "." || segment === "..";
            })
        ) {
            throw new WizError(
                `Registry archive contains an unsafe path: ${path}`,
            );
        }

        size += file.size;
    }

    if (size > 100 * 1024 * 1024) {
        throw new WizError(
            "Registry archive expands beyond the safe size limit",
        );
    }
}

/** Downloads, verifies, and atomically materializes an immutable registry archive. */
export async function ensureRegistryStored(
    home: string,
    resolved: ResolvedRegistryPackage,
): Promise<string> {
    const repository = `registry:${resolved.registry}/${resolved.name}`;

    const destination = storePath(home, repository, resolved.version);

    try {
        await access(join(destination, "manifest.json"));

        return destination;
    } catch {
        // An absent archive is a normal immutable-store cache miss.
    }

    if (process.env.WIZ_OFFLINE === "true") {
        throw new WizError(
            `Offline cache miss for ${resolved.name}@${resolved.version}`,
        );
    }

    const client = new RegistryClient({
        baseUrl: resolved.registry,
        ...(resolved.token === undefined ? {} : { token: resolved.token }),
    });

    const bytes = await client.downloads.archive(
        resolved.name,
        resolved.version,
    );

    if (
        bytes.byteLength !== resolved.size ||
        digest(bytes) !== resolved.integrity
    ) {
        throw new WizError(
            `Registry integrity mismatch for ${resolved.name}@${resolved.version}`,
        );
    }

    const archive = new Bun.Archive(bytes);

    const entries = await archive.files();

    safeArchiveEntries(entries);

    const temporary = `${destination}.tmp-${crypto.randomUUID()}`;

    await mkdir(dirname(destination), { recursive: true });

    try {
        await archive.extract(temporary);

        await rename(temporary, destination);
    } catch (err) {
        await rm(temporary, { recursive: true, force: true });

        try {
            await access(join(destination, "manifest.json"));
        } catch {
            throw err;
        }
    }

    return destination;
}
