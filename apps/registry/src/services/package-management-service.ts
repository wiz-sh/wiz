import { and, eq, isNull } from "drizzle-orm";
import type { RegistryDatabase } from "../database/client.ts";
import {
    organizationMembers,
    organizations,
    packageAccessGrants,
    packageCollaborators,
    packageDeprecations,
    packageDistTags,
    packageDownloadRollups,
    packageManifests,
    packages,
    packageTombstones,
    packageVersions,
    users,
} from "../database/schema.ts";
import { RegistryHttpError } from "../middleware/errors.ts";
import { requireTokenScope } from "../security/authorization.ts";
import { normalizeIdentity, normalizePackageName } from "../security/names.ts";
import type { AuthPrincipal } from "./auth-service.ts";

const tagPattern = /^[a-z][a-z0-9._-]{0,63}$/;

export class PackageManagementService {
    readonly #database: RegistryDatabase;

    constructor(database: RegistryDatabase) {
        this.#database = database;
    }

    private authorize(principal: AuthPrincipal): void {
        requireTokenScope(principal.scopes, "packages:write");
    }

    async update(
        principal: AuthPrincipal,
        name: string,
        input: {
            description?: string | null;
            visibility?: "public" | "private";
        },
    ) {
        const packageRecord = await this.owned(principal, name);

        const [updated] = await this.#database
            .update(packages)
            .set({ ...input, updatedAt: new Date() })
            .where(eq(packages.id, packageRecord.id))
            .returning();

        return updated;
    }

    async remove(
        principal: AuthPrincipal,
        name: string,
        reason?: string,
    ): Promise<void> {
        const packageRecord = await this.owned(principal, name);

        await this.#database.transaction(async (transaction) => {
            await transaction
                .update(packages)
                .set({ deletedAt: new Date() })
                .where(eq(packages.id, packageRecord.id));

            await transaction.insert(packageTombstones).values({
                packageNameNormalized: packageRecord.nameNormalized,
                deletedBy: principal.userId,
                reason,
            });
        });
    }

    async setTag(
        principal: AuthPrincipal,
        name: string,
        tag: string,
        versionValue: string,
    ) {
        if (!tagPattern.test(tag) || tag === "*" || tag.match(/^v?\d/)) {
            throw new RegistryHttpError(
                "DIST_TAG_INVALID",
                400,
                "Distribution tag is invalid.",
            );
        }

        const packageRecord = await this.owned(principal, name);

        const [version] = await this.#database
            .select()
            .from(packageVersions)
            .where(
                and(
                    eq(packageVersions.packageId, packageRecord.id),
                    eq(packageVersions.version, versionValue),
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

        await this.#database
            .insert(packageDistTags)
            .values({
                packageId: packageRecord.id,
                tag,
                versionId: version.id,
            })
            .onConflictDoUpdate({
                target: [packageDistTags.packageId, packageDistTags.tag],
                set: { versionId: version.id, updatedAt: new Date() },
            });

        return { tag, version: version.version };
    }

    async removeTag(
        principal: AuthPrincipal,
        name: string,
        tag: string,
    ): Promise<void> {
        const packageRecord = await this.owned(principal, name);

        await this.#database
            .delete(packageDistTags)
            .where(
                and(
                    eq(packageDistTags.packageId, packageRecord.id),
                    eq(packageDistTags.tag, tag),
                ),
            );
    }

    async tags(name: string) {
        const packageRecord = await this.find(name);

        const records = await this.#database
            .select({
                tag: packageDistTags.tag,
                version: packageVersions.version,
            })
            .from(packageDistTags)
            .innerJoin(
                packageVersions,
                eq(packageVersions.id, packageDistTags.versionId),
            )
            .where(eq(packageDistTags.packageId, packageRecord.id));

        return Object.fromEntries(
            records.map(({ tag, version }) => {
                return [tag, version];
            }),
        );
    }

    async deprecate(
        principal: AuthPrincipal,
        name: string,
        versionValue: string,
        message: string,
    ) {
        const packageRecord = await this.owned(principal, name);

        const [version] = await this.#database
            .select()
            .from(packageVersions)
            .where(
                and(
                    eq(packageVersions.packageId, packageRecord.id),
                    eq(packageVersions.version, versionValue),
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

        await this.#database
            .insert(packageDeprecations)
            .values({
                versionId: version.id,
                message,
                deprecatedBy: principal.userId,
            })
            .onConflictDoUpdate({
                target: packageDeprecations.versionId,
                set: { message, deprecatedBy: principal.userId },
            });

        return { version: version.version, message };
    }

    async removeDeprecation(
        principal: AuthPrincipal,
        name: string,
        versionValue: string,
    ): Promise<void> {
        const packageRecord = await this.owned(principal, name);

        const [version] = await this.#database
            .select({ id: packageVersions.id })
            .from(packageVersions)
            .where(
                and(
                    eq(packageVersions.packageId, packageRecord.id),
                    eq(packageVersions.version, versionValue),
                ),
            )
            .limit(1);

        if (version !== undefined) {
            await this.#database
                .delete(packageDeprecations)
                .where(eq(packageDeprecations.versionId, version.id));
        }
    }

    async collaborator(
        principal: AuthPrincipal,
        name: string,
        username: string,
        permission: string,
    ) {
        const packageRecord = await this.owned(principal, name);

        const user = await this.user(username);

        await this.#database
            .insert(packageCollaborators)
            .values({
                packageId: packageRecord.id,
                userId: user.id,
                permission,
            })
            .onConflictDoUpdate({
                target: [
                    packageCollaborators.packageId,
                    packageCollaborators.userId,
                ],
                set: { permission },
            });

        return { username: user.username, permission };
    }

    async collaborators(principal: AuthPrincipal, name: string) {
        const packageRecord = await this.owned(principal, name);

        return this.#database
            .select({
                username: users.username,
                permission: packageCollaborators.permission,
            })
            .from(packageCollaborators)
            .innerJoin(users, eq(users.id, packageCollaborators.userId))
            .where(eq(packageCollaborators.packageId, packageRecord.id));
    }

    async removeCollaborator(
        principal: AuthPrincipal,
        name: string,
        username: string,
    ): Promise<void> {
        const packageRecord = await this.owned(principal, name);

        const user = await this.user(username);

        await this.#database
            .delete(packageCollaborators)
            .where(
                and(
                    eq(packageCollaborators.packageId, packageRecord.id),
                    eq(packageCollaborators.userId, user.id),
                ),
            );
    }

    async grant(
        principal: AuthPrincipal,
        name: string,
        input: { username: string; permission: string },
    ) {
        const packageRecord = await this.owned(principal, name);

        const user = await this.user(input.username);

        const [created] = await this.#database
            .insert(packageAccessGrants)
            .values({
                packageId: packageRecord.id,
                userId: user.id,
                permission: input.permission,
            })
            .returning();

        return {
            id: created?.id,
            username: user.username,
            permission: input.permission,
        };
    }

    async removeGrant(
        principal: AuthPrincipal,
        name: string,
        grantId: string,
    ): Promise<void> {
        const packageRecord = await this.owned(principal, name);

        await this.#database
            .delete(packageAccessGrants)
            .where(
                and(
                    eq(packageAccessGrants.id, grantId),
                    eq(packageAccessGrants.packageId, packageRecord.id),
                ),
            );
    }

    async grants(principal: AuthPrincipal, name: string) {
        const packageRecord = await this.owned(principal, name);

        return this.#database
            .select({
                id: packageAccessGrants.id,
                username: users.username,
                permission: packageAccessGrants.permission,
                createdAt: packageAccessGrants.createdAt,
            })
            .from(packageAccessGrants)
            .leftJoin(users, eq(users.id, packageAccessGrants.userId))
            .where(eq(packageAccessGrants.packageId, packageRecord.id));
    }

    async transfer(
        principal: AuthPrincipal,
        name: string,
        target: { username?: string; organization?: string },
    ) {
        const packageRecord = await this.owned(principal, name);

        if (
            (target.username === undefined) ===
            (target.organization === undefined)
        ) {
            throw new RegistryHttpError(
                "VALIDATION_FAILED",
                422,
                "Provide exactly one transfer target.",
            );
        }

        let ownerUserId: string | null = null;

        let ownerOrganizationId: string | null = null;

        if (target.username !== undefined) {
            ownerUserId = (await this.user(target.username)).id;
        } else {
            const [organization] = await this.#database
                .select({ id: organizations.id })
                .from(organizations)
                .innerJoin(
                    organizationMembers,
                    eq(organizationMembers.organizationId, organizations.id),
                )
                .where(
                    and(
                        eq(
                            organizations.nameNormalized,
                            normalizeIdentity(target.organization ?? ""),
                        ),
                        eq(organizationMembers.userId, principal.userId),
                    ),
                )
                .limit(1);

            if (organization === undefined) {
                throw new RegistryHttpError(
                    "INSUFFICIENT_PERMISSION",
                    403,
                    "The transfer target organization is unavailable.",
                );
            }

            ownerOrganizationId = organization.id;
        }

        await this.#database
            .update(packages)
            .set({ ownerUserId, ownerOrganizationId, updatedAt: new Date() })
            .where(eq(packages.id, packageRecord.id));

        return { transferred: true };
    }

    async dependencies(name: string, versionValue?: string) {
        const packageRecord = await this.find(name);

        const [version] = await this.#database
            .select()
            .from(packageVersions)
            .where(
                and(
                    eq(packageVersions.packageId, packageRecord.id),
                    ...(versionValue === undefined
                        ? []
                        : [eq(packageVersions.version, versionValue)]),
                ),
            )
            .orderBy(packageVersions.publishedAt)
            .limit(1);

        if (version === undefined) {
            return {};
        }

        const [manifest] = await this.#database
            .select({ normalized: packageManifests.normalized })
            .from(packageManifests)
            .where(eq(packageManifests.versionId, version.id))
            .limit(1);

        const dependencies = manifest?.normalized.dependencies;

        return dependencies !== null &&
            typeof dependencies === "object" &&
            !Array.isArray(dependencies)
            ? dependencies
            : {};
    }

    async dependents(name: string) {
        const normalized = normalizePackageName(name);

        const records = await this.#database
            .select({
                packageName: packages.name,
                version: packageVersions.version,
                manifest: packageManifests.normalized,
            })
            .from(packageManifests)
            .innerJoin(
                packageVersions,
                eq(packageVersions.id, packageManifests.versionId),
            )
            .innerJoin(packages, eq(packages.id, packageVersions.packageId));

        return records
            .filter(({ manifest }) => {
                const dependencies = manifest.dependencies;

                return (
                    dependencies !== null &&
                    typeof dependencies === "object" &&
                    !Array.isArray(dependencies) &&
                    normalized in dependencies
                );
            })
            .map(({ packageName, version }) => {
                return { package: packageName, version };
            });
    }

    async downloads(name: string) {
        const packageRecord = await this.find(name);

        return this.#database
            .select({
                day: packageDownloadRollups.day,
                downloads: packageDownloadRollups.downloads,
                version: packageVersions.version,
            })
            .from(packageDownloadRollups)
            .innerJoin(
                packageVersions,
                eq(packageVersions.id, packageDownloadRollups.versionId),
            )
            .where(eq(packageDownloadRollups.packageId, packageRecord.id));
    }

    private async find(name: string) {
        const normalized = normalizePackageName(name);

        const [record] = await this.#database
            .select()
            .from(packages)
            .where(
                and(
                    eq(packages.nameNormalized, normalized),
                    isNull(packages.deletedAt),
                ),
            )
            .limit(1);

        if (record === undefined) {
            throw new RegistryHttpError(
                "PACKAGE_NOT_FOUND",
                404,
                "Package was not found.",
            );
        }

        return record;
    }

    private async owned(principal: AuthPrincipal, name: string) {
        this.authorize(principal);

        const record = await this.find(name);

        if (record.ownerUserId === principal.userId) {
            return record;
        }

        if (record.ownerOrganizationId !== null) {
            const [membership] = await this.#database
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
                membership !== undefined &&
                ["owner", "admin", "maintainer"].includes(membership.role)
            ) {
                return record;
            }
        }

        throw new RegistryHttpError(
            "INSUFFICIENT_PERMISSION",
            403,
            "Package management permission is required.",
        );
    }

    private async user(username: string) {
        const [record] = await this.#database
            .select()
            .from(users)
            .where(eq(users.usernameNormalized, normalizeIdentity(username)))
            .limit(1);

        if (record === undefined) {
            throw new RegistryHttpError(
                "RESOURCE_NOT_FOUND",
                404,
                "User was not found.",
            );
        }

        return record;
    }
}
