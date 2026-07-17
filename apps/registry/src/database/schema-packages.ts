import { sql } from "drizzle-orm";
import {
    bigint,
    check,
    date,
    index,
    integer,
    jsonb,
    pgTable,
    primaryKey,
    text,
    timestamp,
    unique,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";
import { accessTokens, users } from "./schema-auth.ts";
import { organizations, organizationTeams } from "./schema-organizations.ts";

export const packages = pgTable(
    "packages",
    {
        id: uuid().defaultRandom().primaryKey(),
        name: text().notNull(),
        nameNormalized: text("name_normalized").notNull(),
        ownerUserId: uuid("owner_user_id").references(() => users.id),
        ownerOrganizationId: uuid("owner_organization_id").references(
            () => organizations.id,
        ),
        description: text(),
        visibility: text().notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        deletedAt: timestamp("deleted_at", { withTimezone: true }),
        quarantinedAt: timestamp("quarantined_at", { withTimezone: true }),
        quarantineReason: text("quarantine_reason"),
    },
    (table) => {
        return [
            uniqueIndex("packages_name_normalized_unique").on(
                table.nameNormalized,
            ),
            check(
                "packages_visibility_check",
                sql`${table.visibility} IN ('public', 'private')`,
            ),
            check(
                "packages_owner_check",
                sql`(${table.ownerUserId} IS NOT NULL)::integer + (${table.ownerOrganizationId} IS NOT NULL)::integer = 1`,
            ),
            index("package_search_index").using(
                "gin",
                sql`to_tsvector('simple', ${table.name} || ' ' || coalesce(${table.description}, ''))`,
            ),
        ];
    },
);

export const organizationTeamPackages = pgTable(
    "organization_team_packages",
    {
        teamId: uuid("team_id")
            .notNull()
            .references(() => organizationTeams.id, { onDelete: "cascade" }),
        packageId: uuid("package_id")
            .notNull()
            .references(() => packages.id, { onDelete: "cascade" }),
        permission: text().notNull(),
    },
    (table) => {
        return [
            primaryKey({ columns: [table.teamId, table.packageId] }),
            check(
                "organization_team_packages_permission_check",
                sql`${table.permission} IN ('read', 'triage', 'publish', 'manage', 'admin')`,
            ),
        ];
    },
);

export const packageVersions = pgTable(
    "package_versions",
    {
        id: uuid().defaultRandom().primaryKey(),
        packageId: uuid("package_id")
            .notNull()
            .references(() => packages.id, { onDelete: "restrict" }),
        version: text().notNull(),
        archiveKey: text("archive_key").notNull(),
        archiveIntegrity: text("archive_integrity").notNull(),
        archiveSize: bigint("archive_size", { mode: "bigint" }).notNull(),
        publisherId: uuid("publisher_id")
            .notNull()
            .references(() => users.id),
        publisherTokenId: uuid("publisher_token_id").references(
            () => accessTokens.id,
        ),
        provenance: jsonb()
            .$type<Record<string, unknown>>()
            .default(sql`'{}'::jsonb`)
            .notNull(),
        publishedAt: timestamp("published_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => {
        return [
            uniqueIndex("package_versions_archive_key_unique").on(
                table.archiveKey,
            ),
            unique("package_versions_package_version_unique").on(
                table.packageId,
                table.version,
            ),
            check(
                "package_versions_archive_size_check",
                sql`${table.archiveSize} >= 0`,
            ),
        ];
    },
);

export const packageManifests = pgTable("package_manifests", {
    versionId: uuid("version_id")
        .primaryKey()
        .references(() => packageVersions.id, { onDelete: "restrict" }),
    original: jsonb().$type<Record<string, unknown>>().notNull(),
    parsed: jsonb().$type<Record<string, unknown>>().notNull(),
    normalized: jsonb().$type<Record<string, unknown>>().notNull(),
});

export const packageDistTags = pgTable(
    "package_dist_tags",
    {
        packageId: uuid("package_id")
            .notNull()
            .references(() => packages.id, { onDelete: "cascade" }),
        tag: text().notNull(),
        versionId: uuid("version_id")
            .notNull()
            .references(() => packageVersions.id, { onDelete: "restrict" }),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => {
        return [primaryKey({ columns: [table.packageId, table.tag] })];
    },
);

export const packageCollaborators = pgTable(
    "package_collaborators",
    {
        packageId: uuid("package_id")
            .notNull()
            .references(() => packages.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        permission: text().notNull(),
    },
    (table) => {
        return [primaryKey({ columns: [table.packageId, table.userId] })];
    },
);

export const packageAccessGrants = pgTable(
    "package_access_grants",
    {
        id: uuid().defaultRandom().primaryKey(),
        packageId: uuid("package_id")
            .notNull()
            .references(() => packages.id, { onDelete: "cascade" }),
        userId: uuid("user_id").references(() => users.id, {
            onDelete: "cascade",
        }),
        organizationId: uuid("organization_id").references(
            () => organizations.id,
            { onDelete: "cascade" },
        ),
        permission: text().notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => {
        return [
            check(
                "package_access_grants_principal_check",
                sql`(${table.userId} IS NOT NULL)::integer + (${table.organizationId} IS NOT NULL)::integer = 1`,
            ),
        ];
    },
);

export const packageTransfers = pgTable("package_transfers", {
    id: uuid().defaultRandom().primaryKey(),
    packageId: uuid("package_id")
        .notNull()
        .references(() => packages.id),
    fromUserId: uuid("from_user_id").references(() => users.id),
    fromOrganizationId: uuid("from_organization_id").references(
        () => organizations.id,
    ),
    toUserId: uuid("to_user_id").references(() => users.id),
    toOrganizationId: uuid("to_organization_id").references(
        () => organizations.id,
    ),
    initiatedBy: uuid("initiated_by")
        .notNull()
        .references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

export const packageDeprecations = pgTable("package_deprecations", {
    versionId: uuid("version_id")
        .primaryKey()
        .references(() => packageVersions.id, { onDelete: "cascade" }),
    message: text().notNull(),
    deprecatedBy: uuid("deprecated_by")
        .notNull()
        .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

export const packageTombstones = pgTable(
    "package_tombstones",
    {
        id: uuid().defaultRandom().primaryKey(),
        packageNameNormalized: text("package_name_normalized").notNull(),
        version: text(),
        archiveIntegrity: text("archive_integrity"),
        deletedBy: uuid("deleted_by").references(() => users.id),
        reason: text(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => {
        return [
            unique("package_tombstones_package_version_unique").on(
                table.packageNameNormalized,
                table.version,
            ),
        ];
    },
);

export const packageFileEntries = pgTable(
    "package_file_entries",
    {
        versionId: uuid("version_id")
            .notNull()
            .references(() => packageVersions.id, { onDelete: "cascade" }),
        path: text().notNull(),
        size: bigint({ mode: "bigint" }).notNull(),
        mode: integer().notNull(),
        integrity: text().notNull(),
    },
    (table) => {
        return [primaryKey({ columns: [table.versionId, table.path] })];
    },
);

export const packageDownloadRollups = pgTable(
    "package_download_rollups",
    {
        packageId: uuid("package_id")
            .notNull()
            .references(() => packages.id, { onDelete: "cascade" }),
        versionId: uuid("version_id")
            .notNull()
            .references(() => packageVersions.id, {
                onDelete: "cascade",
            }),
        day: date().notNull(),
        downloads: bigint({ mode: "bigint" }).default(sql`0`).notNull(),
    },
    (table) => {
        return [
            primaryKey({
                columns: [table.packageId, table.versionId, table.day],
            }),
        ];
    },
);

export const publishTransactions = pgTable(
    "publish_transactions",
    {
        id: uuid().defaultRandom().primaryKey(),
        packageId: uuid("package_id")
            .notNull()
            .references(() => packages.id, { onDelete: "cascade" }),
        version: text().notNull(),
        publisherId: uuid("publisher_id")
            .notNull()
            .references(() => users.id),
        publisherTokenId: uuid("publisher_token_id").references(
            () => accessTokens.id,
        ),
        state: text().notNull(),
        archiveKey: text("archive_key").notNull(),
        expectedIntegrity: text("expected_integrity").notNull(),
        expectedSize: bigint("expected_size", { mode: "bigint" }).notNull(),
        errorCode: text("error_code"),
        errorMessage: text("error_message"),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => {
        return [
            uniqueIndex("publish_transactions_archive_key_unique").on(
                table.archiveKey,
            ),
            unique("publish_transactions_package_version_unique").on(
                table.packageId,
                table.version,
            ),
            check(
                "publish_transactions_state_check",
                sql`${table.state} IN ('created', 'uploaded', 'processing', 'published', 'failed')`,
            ),
        ];
    },
);
