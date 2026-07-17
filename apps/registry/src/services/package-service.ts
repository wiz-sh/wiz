import { and, asc, desc, eq, ilike, isNull, or } from "drizzle-orm";
import type { RegistryServerConfig } from "../config/types.ts";
import type { RegistryDatabase } from "../database/client.ts";
import {
    jobs,
    organizationMembers,
    organizations,
    outboxEvents,
    packageAccessGrants,
    packageDeprecations,
    packageDistTags,
    packageFileEntries,
    packageManifests,
    packages,
    packageTombstones,
    packageVersions,
    publishTransactions,
    users,
} from "../database/schema.ts";
import { RegistryHttpError } from "../middleware/errors.ts";
import { requireTokenScope } from "../security/authorization.ts";
import { normalizePackageName, packageScope } from "../security/names.ts";
import type { ArchiveStorage } from "../storage/types.ts";
import { archiveIntegrity, validatePackageArchive } from "./archive-service.ts";
import type { AuthPrincipal } from "./auth-service.ts";

const semanticVersion =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function packageResponse(
    record: typeof packages.$inferSelect,
    latestVersion?: string,
    tags: Readonly<Record<string, string>> = {},
) {
    return {
        id: record.id,
        name: record.name,
        ...(record.description === null
            ? {}
            : { description: record.description }),
        visibility: record.visibility as "public" | "private",
        ...(latestVersion === undefined ? {} : { latestVersion }),
        distTags: tags,
    };
}

export interface PackageSearchInput {
    query: string;
    cursor?: string;
    scope?: string;
    owner?: string;
    keyword?: string;
    visibility?: "public" | "private";
    sort?: "relevance" | "name" | "name-desc" | "recent";
    limit?: number;
}

function searchOffset(cursor: string | undefined): number {
    if (cursor === undefined) {
        return 0;
    }

    try {
        const parsed = JSON.parse(
            atob(cursor.replaceAll("-", "+").replaceAll("_", "/")),
        ) as {
            offset?: unknown;
        };

        if (
            typeof parsed.offset !== "number" ||
            !Number.isSafeInteger(parsed.offset) ||
            parsed.offset < 0
        ) {
            throw new Error("Invalid offset");
        }

        return parsed.offset;
    } catch {
        throw new RegistryHttpError(
            "VALIDATION_FAILED",
            422,
            "Search cursor is invalid or expired.",
        );
    }
}

function searchCursor(offset: number): string {
    return btoa(JSON.stringify({ offset }))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");
}

/** Implements immutable package metadata, publishing, download, and search operations. */
export class PackageService {
    readonly #database: RegistryDatabase;

    readonly #storage: ArchiveStorage;

    readonly #config: RegistryServerConfig;

    constructor(
        database: RegistryDatabase,
        storage: ArchiveStorage,
        config: RegistryServerConfig,
    ) {
        this.#database = database;
        this.#storage = storage;
        this.#config = config;
    }

    async create(
        principal: AuthPrincipal,
        input: {
            name: string;
            description?: string;
            visibility: "public" | "private";
        },
    ) {
        requireTokenScope(principal.scopes, "packages:write");

        let name: string;

        try {
            name = normalizePackageName(input.name);
        } catch {
            throw new RegistryHttpError(
                "PACKAGE_NAME_INVALID",
                400,
                "Package name is invalid.",
            );
        }

        this.requirePackageToken(principal, name);

        const scope = packageScope(name);

        let ownerUserId: string | undefined = principal.userId;

        let ownerOrganizationId: string | undefined;

        if (scope !== undefined) {
            const [user] = await this.#database
                .select({ id: users.id })
                .from(users)
                .where(
                    and(
                        eq(users.id, principal.userId),
                        eq(users.usernameNormalized, scope),
                    ),
                )
                .limit(1);

            if (user === undefined) {
                const [membership] = await this.#database
                    .select({ organizationId: organizations.id })
                    .from(organizations)
                    .innerJoin(
                        organizationMembers,
                        eq(
                            organizationMembers.organizationId,
                            organizations.id,
                        ),
                    )
                    .where(
                        and(
                            eq(organizations.nameNormalized, scope),
                            eq(organizationMembers.userId, principal.userId),
                            or(
                                eq(organizationMembers.role, "owner"),
                                eq(organizationMembers.role, "admin"),
                                eq(organizationMembers.role, "maintainer"),
                            ),
                        ),
                    )
                    .limit(1);

                if (membership === undefined) {
                    throw new RegistryHttpError(
                        "INSUFFICIENT_PERMISSION",
                        403,
                        "The authenticated principal cannot publish in this scope.",
                    );
                }

                ownerUserId = undefined;
                ownerOrganizationId = membership.organizationId;
            }
        }

        try {
            let created: typeof packages.$inferSelect | undefined;

            await this.#database.transaction(async (transaction) => {
                [created] = await transaction
                    .insert(packages)
                    .values({
                        name,
                        nameNormalized: name,
                        visibility: input.visibility,
                        ...(input.description === undefined
                            ? {}
                            : { description: input.description }),
                        ...(ownerUserId === undefined ? {} : { ownerUserId }),
                        ...(ownerOrganizationId === undefined
                            ? {}
                            : { ownerOrganizationId }),
                    })
                    .returning();

                if (created !== undefined) {
                    await transaction.insert(outboxEvents).values({
                        topic: "webhook.package.created",
                        payload: {
                            eventType: "package.created",
                            packageId: created.id,
                            organizationId: created.ownerOrganizationId,
                            package: created.name,
                        },
                    });
                }
            });

            if (created === undefined) {
                throw new Error("Package insert did not return a row");
            }

            return packageResponse(created);
        } catch (err) {
            if (String(err).includes("unique")) {
                throw new RegistryHttpError(
                    "RESOURCE_CONFLICT",
                    409,
                    "Package name is already registered.",
                );
            }

            throw err;
        }
    }

    async get(nameInput: string, principal?: AuthPrincipal) {
        const record = await this.findVisible(nameInput, principal);

        const versions = await this.#database
            .select({ version: packageVersions.version })
            .from(packageVersions)
            .where(eq(packageVersions.packageId, record.id))
            .orderBy(desc(packageVersions.publishedAt));

        const tags = await this.#database
            .select({
                tag: packageDistTags.tag,
                version: packageVersions.version,
            })
            .from(packageDistTags)
            .innerJoin(
                packageVersions,
                eq(packageVersions.id, packageDistTags.versionId),
            )
            .where(eq(packageDistTags.packageId, record.id));

        return packageResponse(
            record,
            versions[0]?.version,
            Object.fromEntries(
                tags.map((entry) => {
                    return [entry.tag, entry.version];
                }),
            ),
        );
    }

    async versions(nameInput: string, principal?: AuthPrincipal) {
        const record = await this.findVisible(nameInput, principal);

        const versions = await this.#database
            .select()
            .from(packageVersions)
            .where(eq(packageVersions.packageId, record.id))
            .orderBy(desc(packageVersions.publishedAt));

        return Promise.all(
            versions.map((version) => {
                return this.versionResponse(record.name, version);
            }),
        );
    }

    async version(
        nameInput: string,
        versionInput: string,
        principal?: AuthPrincipal,
    ) {
        const record = await this.findVisible(nameInput, principal);

        const [version] = await this.#database
            .select()
            .from(packageVersions)
            .where(
                and(
                    eq(packageVersions.packageId, record.id),
                    eq(packageVersions.version, versionInput),
                ),
            )
            .limit(1);

        if (version === undefined) {
            throw new RegistryHttpError(
                "PACKAGE_VERSION_NOT_FOUND",
                404,
                "Package version was not found.",
            );
        }

        return this.versionResponse(record.name, version);
    }

    private async versionResponse(
        packageName: string,
        version: typeof packageVersions.$inferSelect,
    ) {
        const [manifest] = await this.#database
            .select()
            .from(packageManifests)
            .where(eq(packageManifests.versionId, version.id))
            .limit(1);

        const [deprecation] = await this.#database
            .select()
            .from(packageDeprecations)
            .where(eq(packageDeprecations.versionId, version.id))
            .limit(1);

        return {
            packageName,
            version: version.version,
            integrity: version.archiveIntegrity,
            archiveUrl: `${this.#config.publicUrl}/v1/packages/${encodeURIComponent(packageName)}/versions/${encodeURIComponent(version.version)}/archive`,
            archiveSize: Number(version.archiveSize),
            manifest: manifest?.normalized ?? {},
            publishedAt: version.publishedAt.toISOString(),
            ...(deprecation === undefined
                ? {}
                : { deprecated: deprecation.message }),
        };
    }

    async createPublish(
        principal: AuthPrincipal,
        nameInput: string,
        input: { version: string; integrity: string; size: number },
    ) {
        requireTokenScope(principal.scopes, "packages:write");

        if (!semanticVersion.test(input.version)) {
            throw new RegistryHttpError(
                "VALIDATION_FAILED",
                400,
                "Package version must be valid semantic versioning.",
            );
        }

        const record = await this.findWritable(nameInput, principal, "publish");

        const [existing] = await this.#database
            .select({ id: packageVersions.id })
            .from(packageVersions)
            .where(
                and(
                    eq(packageVersions.packageId, record.id),
                    eq(packageVersions.version, input.version),
                ),
            )
            .limit(1);

        const [tombstone] = await this.#database
            .select({ id: packageTombstones.id })
            .from(packageTombstones)
            .where(
                and(
                    eq(
                        packageTombstones.packageNameNormalized,
                        record.nameNormalized,
                    ),
                    eq(packageTombstones.version, input.version),
                ),
            )
            .limit(1);

        if (existing !== undefined || tombstone !== undefined) {
            throw new RegistryHttpError(
                "PACKAGE_VERSION_EXISTS",
                409,
                `Version ${input.version} already exists and is immutable.`,
            );
        }

        const id = crypto.randomUUID();

        const archiveKey = `publishes/${id}.tar.gz`;

        const [created] = await this.#database
            .insert(publishTransactions)
            .values({
                id,
                packageId: record.id,
                version: input.version,
                publisherId: principal.userId,
                ...(principal.tokenId === undefined
                    ? {}
                    : { publisherTokenId: principal.tokenId }),
                state: "created",
                archiveKey,
                expectedIntegrity: input.integrity,
                expectedSize: BigInt(input.size),
                expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
            })
            .returning();

        return this.publishResponse(record.name, created);
    }

    async uploadPublish(
        principal: AuthPrincipal,
        nameInput: string,
        publishId: string,
        bytes: Uint8Array,
    ): Promise<void> {
        requireTokenScope(principal.scopes, "packages:write");

        const { packageRecord, publish } = await this.publishRecord(
            nameInput,
            publishId,
            principal,
        );

        if (publish.state !== "created") {
            throw new RegistryHttpError(
                "RESOURCE_CONFLICT",
                409,
                "Publish transaction is not awaiting an upload.",
            );
        }

        if (bytes.byteLength !== Number(publish.expectedSize)) {
            throw new RegistryHttpError(
                "PACKAGE_INTEGRITY_MISMATCH",
                400,
                "Uploaded archive size does not match the publish transaction.",
            );
        }

        await this.#storage.put(publish.archiveKey, bytes);

        await this.#database
            .update(publishTransactions)
            .set({ state: "uploaded", updatedAt: new Date() })
            .where(eq(publishTransactions.id, publish.id));

        void packageRecord;
    }

    async finalizePublish(
        principal: AuthPrincipal,
        nameInput: string,
        publishId: string,
    ) {
        requireTokenScope(principal.scopes, "packages:write");

        const { packageRecord, publish } = await this.publishRecord(
            nameInput,
            publishId,
            principal,
        );

        if (publish.state !== "uploaded") {
            throw new RegistryHttpError(
                "RESOURCE_CONFLICT",
                409,
                "Publish transaction has no uploaded archive.",
            );
        }

        const bytes = await this.#storage.get(publish.archiveKey);

        const actualIntegrity = await archiveIntegrity(bytes);

        if (
            actualIntegrity !== publish.expectedIntegrity ||
            bytes.byteLength !== Number(publish.expectedSize)
        ) {
            throw new RegistryHttpError(
                "PACKAGE_INTEGRITY_MISMATCH",
                400,
                "Uploaded archive integrity does not match the publish transaction.",
            );
        }

        await this.#database
            .update(publishTransactions)
            .set({ state: "processing", updatedAt: new Date() })
            .where(eq(publishTransactions.id, publish.id));

        try {
            const validated = await validatePackageArchive(
                bytes,
                packageRecord.name,
                publish.version,
            );

            const immutableKey = `packages/${encodeURIComponent(packageRecord.name)}/${publish.version}/${actualIntegrity.replaceAll("/", "_")}.tar.gz`;

            await this.#storage.put(immutableKey, bytes);

            await this.#database.transaction(async (transaction) => {
                const [version] = await transaction
                    .insert(packageVersions)
                    .values({
                        packageId: packageRecord.id,
                        version: publish.version,
                        archiveKey: immutableKey,
                        archiveIntegrity: actualIntegrity,
                        archiveSize: BigInt(bytes.byteLength),
                        publisherId: principal.userId,
                        ...(principal.tokenId === undefined
                            ? {}
                            : { publisherTokenId: principal.tokenId }),
                    })
                    .returning();

                if (version === undefined) {
                    throw new Error("Version insert did not return a row");
                }

                await transaction.insert(packageManifests).values({
                    versionId: version.id,
                    original: validated.manifest,
                    parsed: validated.manifest,
                    normalized: validated.manifest,
                });

                if (validated.entries.length > 0) {
                    await transaction.insert(packageFileEntries).values(
                        validated.entries.map((entry) => {
                            return {
                                versionId: version.id,
                                path: entry.path,
                                size: BigInt(entry.size),
                                mode: entry.mode,
                                integrity: entry.integrity,
                            };
                        }),
                    );
                }

                await transaction
                    .insert(packageDistTags)
                    .values({
                        packageId: packageRecord.id,
                        tag: "latest",
                        versionId: version.id,
                    })
                    .onConflictDoUpdate({
                        target: [
                            packageDistTags.packageId,
                            packageDistTags.tag,
                        ],
                        set: { versionId: version.id, updatedAt: new Date() },
                    });

                await transaction
                    .update(publishTransactions)
                    .set({ state: "published", updatedAt: new Date() })
                    .where(eq(publishTransactions.id, publish.id));

                await transaction.insert(outboxEvents).values({
                    topic: "webhook.package.published",
                    payload: {
                        eventType: "package.published",
                        packageId: packageRecord.id,
                        organizationId: packageRecord.ownerOrganizationId,
                        package: packageRecord.name,
                        version: publish.version,
                    },
                });
            });

            await this.#storage.remove(publish.archiveKey);

            const [completed] = await this.#database
                .select()
                .from(publishTransactions)
                .where(eq(publishTransactions.id, publish.id))
                .limit(1);

            return this.publishResponse(packageRecord.name, completed);
        } catch (err) {
            await this.#database
                .update(publishTransactions)
                .set({
                    state: "failed",
                    errorCode:
                        err instanceof RegistryHttpError
                            ? err.code
                            : "INTERNAL_ERROR",
                    errorMessage:
                        err instanceof Error ? err.message : "Publish failed",
                    updatedAt: new Date(),
                })
                .where(eq(publishTransactions.id, publish.id));

            throw err;
        }
    }

    async publishStatus(
        principal: AuthPrincipal,
        nameInput: string,
        publishId: string,
    ) {
        const { packageRecord, publish } = await this.publishRecord(
            nameInput,
            publishId,
            principal,
        );

        return this.publishResponse(packageRecord.name, publish);
    }

    private publishResponse(
        packageName: string,
        publish: typeof publishTransactions.$inferSelect | undefined,
    ) {
        if (publish === undefined) {
            throw new RegistryHttpError(
                "RESOURCE_NOT_FOUND",
                404,
                "Publish transaction was not found.",
            );
        }

        return {
            id: publish.id,
            packageName,
            version: publish.version,
            state: publish.state,
            ...(publish.errorMessage === null
                ? {}
                : { error: publish.errorMessage }),
        };
    }

    private async publishRecord(
        nameInput: string,
        publishId: string,
        principal: AuthPrincipal,
    ) {
        const packageRecord = await this.findWritable(
            nameInput,
            principal,
            "publish",
        );

        const [publish] = await this.#database
            .select()
            .from(publishTransactions)
            .where(
                and(
                    eq(publishTransactions.id, publishId),
                    eq(publishTransactions.packageId, packageRecord.id),
                    eq(publishTransactions.publisherId, principal.userId),
                ),
            )
            .limit(1);

        if (publish === undefined || publish.expiresAt <= new Date()) {
            throw new RegistryHttpError(
                "RESOURCE_NOT_FOUND",
                404,
                "Publish transaction was not found.",
            );
        }

        return { packageRecord, publish };
    }

    async archive(
        nameInput: string,
        versionInput: string,
        principal?: AuthPrincipal,
    ) {
        const packageRecord = await this.findVisible(nameInput, principal);

        const [version] = await this.#database
            .select()
            .from(packageVersions)
            .where(
                and(
                    eq(packageVersions.packageId, packageRecord.id),
                    eq(packageVersions.version, versionInput),
                ),
            )
            .limit(1);

        if (version === undefined) {
            throw new RegistryHttpError(
                "PACKAGE_VERSION_NOT_FOUND",
                404,
                "Package version was not found.",
            );
        }

        await this.#database.insert(jobs).values({
            kind: "download.rollup",
            payload: {
                packageId: packageRecord.id,
                versionId: version.id,
            },
        });

        return {
            bytes: await this.#storage.get(version.archiveKey),
            integrity: version.archiveIntegrity,
            public: packageRecord.visibility === "public",
        };
    }

    async search(input: PackageSearchInput, principal?: AuthPrincipal) {
        const offset = searchOffset(input.cursor);

        const limit = Math.min(100, Math.max(1, input.limit ?? 50));

        const query = input.query.replaceAll("%", "\\%").replaceAll("_", "\\_");

        const keyword = input.keyword
            ?.replaceAll("%", "\\%")
            .replaceAll("_", "\\_");

        const conditions = [
            isNull(packages.deletedAt),
            isNull(packages.quarantinedAt),
            or(
                ilike(packages.name, `%${query}%`),
                ilike(packages.description, `%${query}%`),
            ),
        ];

        if (input.scope !== undefined) {
            conditions.push(
                ilike(
                    packages.nameNormalized,
                    `${input.scope.toLowerCase()}/%`,
                ),
            );
        }

        if (keyword !== undefined) {
            conditions.push(ilike(packages.description, `%${keyword}%`));
        }

        if (input.visibility !== undefined) {
            conditions.push(eq(packages.visibility, input.visibility));
        }

        if (input.owner !== undefined) {
            const owner = input.owner.replace(/^@/, "").toLowerCase();

            const [user] = await this.#database
                .select({ id: users.id })
                .from(users)
                .where(eq(users.usernameNormalized, owner))
                .limit(1);

            const [organization] = await this.#database
                .select({ id: organizations.id })
                .from(organizations)
                .where(eq(organizations.nameNormalized, owner))
                .limit(1);

            if (user === undefined && organization === undefined) {
                return { items: [] };
            }

            conditions.push(
                or(
                    ...(user === undefined
                        ? []
                        : [eq(packages.ownerUserId, user.id)]),
                    ...(organization === undefined
                        ? []
                        : [eq(packages.ownerOrganizationId, organization.id)]),
                ),
            );
        }

        const ordering =
            input.sort === "recent"
                ? [desc(packages.updatedAt), asc(packages.nameNormalized)]
                : input.sort === "name-desc"
                  ? [desc(packages.nameNormalized)]
                  : [asc(packages.nameNormalized)];

        // The larger window lets anonymous searches skip private rows without
        // revealing how many inaccessible packages occupied the page.
        const scanLimit = Math.max(limit * 10 + 1, 101);

        const records = await this.#database
            .select()
            .from(packages)
            .where(and(...conditions))
            .orderBy(...ordering)
            .limit(scanLimit)
            .offset(offset);

        const visible: ReturnType<typeof packageResponse>[] = [];

        let consumed = 0;

        let nextOffset: number | undefined;

        for (const record of records) {
            consumed += 1;

            if (
                record.visibility === "public" ||
                (principal !== undefined &&
                    (await this.canReadPrivate(record, principal)))
            ) {
                visible.push(packageResponse(record));

                if (visible.length > limit) {
                    // The lookahead row belongs to the next page and must not be skipped.
                    nextOffset = offset + consumed - 1;

                    break;
                }
            }
        }

        if (nextOffset === undefined && records.length === scanLimit) {
            nextOffset = offset + consumed;
        }

        return {
            items: visible.slice(0, limit),
            ...(nextOffset === undefined
                ? {}
                : { nextCursor: searchCursor(nextOffset) }),
        };
    }

    private async findVisible(nameInput: string, principal?: AuthPrincipal) {
        let name: string;

        try {
            name = normalizePackageName(nameInput);
        } catch {
            throw new RegistryHttpError(
                "PACKAGE_NOT_FOUND",
                404,
                "Package was not found.",
            );
        }

        const [record] = await this.#database
            .select()
            .from(packages)
            .where(
                and(
                    eq(packages.nameNormalized, name),
                    isNull(packages.deletedAt),
                    isNull(packages.quarantinedAt),
                ),
            )
            .limit(1);

        if (
            record === undefined ||
            (record.visibility === "private" &&
                (principal === undefined ||
                    !(await this.canReadPrivate(record, principal))))
        ) {
            // Private resources deliberately share the public not-found response.
            throw new RegistryHttpError(
                "PACKAGE_NOT_FOUND",
                404,
                "Package was not found.",
            );
        }

        return record;
    }

    private async canReadPrivate(
        record: typeof packages.$inferSelect,
        principal: AuthPrincipal,
    ): Promise<boolean> {
        if (record.ownerUserId === principal.userId) {
            return true;
        }

        if (record.ownerOrganizationId !== null) {
            const [member] = await this.#database
                .select({ userId: organizationMembers.userId })
                .from(organizationMembers)
                .where(
                    and(
                        eq(
                            organizationMembers.organizationId,
                            record.ownerOrganizationId,
                        ),
                        eq(organizationMembers.userId, principal.userId),
                    ),
                )
                .limit(1);

            if (member !== undefined) {
                return true;
            }
        }

        const [grant] = await this.#database
            .select({ id: packageAccessGrants.id })
            .from(packageAccessGrants)
            .where(
                and(
                    eq(packageAccessGrants.packageId, record.id),
                    eq(packageAccessGrants.userId, principal.userId),
                ),
            )
            .limit(1);

        return grant !== undefined;
    }

    private async findWritable(
        nameInput: string,
        principal: AuthPrincipal,
        _permission: "publish" | "manage",
    ) {
        const record = await this.findVisible(nameInput, principal);

        this.requirePackageToken(principal, record.nameNormalized);

        if (record.ownerUserId === principal.userId) {
            return record;
        }

        if (record.ownerOrganizationId !== null) {
            const [member] = await this.#database
                .select({ role: organizationMembers.role })
                .from(organizationMembers)
                .where(
                    and(
                        eq(
                            organizationMembers.organizationId,
                            record.ownerOrganizationId,
                        ),
                        eq(organizationMembers.userId, principal.userId),
                    ),
                )
                .limit(1);

            if (
                member !== undefined &&
                ["owner", "admin", "maintainer"].includes(member.role)
            ) {
                return record;
            }
        }

        throw new RegistryHttpError(
            "INSUFFICIENT_PERMISSION",
            403,
            "Package permission is insufficient.",
        );
    }

    private requirePackageToken(
        principal: AuthPrincipal,
        packageName: string,
    ): void {
        if (
            principal.packageRestrictions.length > 0 &&
            !principal.packageRestrictions.includes(packageName)
        ) {
            throw new RegistryHttpError(
                "INSUFFICIENT_PERMISSION",
                403,
                "The access token is not authorized for this package.",
            );
        }
    }
}
