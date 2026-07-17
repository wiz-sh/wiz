import { sql } from "drizzle-orm";
import {
    boolean,
    check,
    integer,
    pgTable,
    primaryKey,
    text,
    timestamp,
    unique,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";
import { users } from "./schema-auth.ts";

export const organizations = pgTable(
    "organizations",
    {
        id: uuid().defaultRandom().primaryKey(),
        name: text().notNull(),
        nameNormalized: text("name_normalized").notNull(),
        displayName: text("display_name").notNull(),
        private: boolean().default(false).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    (table) => {
        return [
            uniqueIndex("organizations_name_normalized_unique").on(
                table.nameNormalized,
            ),
        ];
    },
);

export const organizationMembers = pgTable(
    "organization_members",
    {
        organizationId: uuid("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        role: text().notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => {
        return [
            primaryKey({ columns: [table.organizationId, table.userId] }),
            check(
                "organization_members_role_check",
                sql`${table.role} IN ('owner', 'admin', 'maintainer', 'member', 'billing', 'viewer')`,
            ),
        ];
    },
);

export const organizationInvitations = pgTable(
    "organization_invitations",
    {
        id: uuid().defaultRandom().primaryKey(),
        organizationId: uuid("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        inviterId: uuid("inviter_id")
            .notNull()
            .references(() => users.id),
        usernameNormalized: text("username_normalized"),
        emailNormalized: text("email_normalized"),
        role: text().notNull(),
        tokenHash: text("token_hash").notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        acceptedAt: timestamp("accepted_at", { withTimezone: true }),
        declinedAt: timestamp("declined_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => {
        return [
            uniqueIndex("organization_invitations_token_hash_unique").on(
                table.tokenHash,
            ),
            check(
                "organization_invitations_recipient_check",
                sql`${table.usernameNormalized} IS NOT NULL OR ${table.emailNormalized} IS NOT NULL`,
            ),
        ];
    },
);

export const organizationPolicies = pgTable("organization_policies", {
    organizationId: uuid("organization_id")
        .primaryKey()
        .references(() => organizations.id, { onDelete: "cascade" }),
    requireMfaForPublish: boolean("require_mfa_for_publish")
        .default(false)
        .notNull(),
    defaultPackageVisibility: text("default_package_visibility")
        .default("private")
        .notNull(),
    maximumTokenLifetimeDays: integer("maximum_token_lifetime_days"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

export const organizationTeams = pgTable(
    "organization_teams",
    {
        id: uuid().defaultRandom().primaryKey(),
        organizationId: uuid("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        name: text().notNull(),
        nameNormalized: text("name_normalized").notNull(),
        description: text(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => {
        return [
            unique("organization_teams_name_unique").on(
                table.organizationId,
                table.nameNormalized,
            ),
        ];
    },
);

export const organizationTeamMembers = pgTable(
    "organization_team_members",
    {
        teamId: uuid("team_id")
            .notNull()
            .references(() => organizationTeams.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
    },
    (table) => {
        return [primaryKey({ columns: [table.teamId, table.userId] })];
    },
);
