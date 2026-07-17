import { sql } from "drizzle-orm";
import {
    bigint,
    boolean,
    check,
    customType,
    index,
    inet,
    jsonb,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";

export const bytea = customType<{
    data: Uint8Array;
    driverData: Uint8Array;
}>({
    dataType() {
        return "bytea";
    },
});

export const users = pgTable(
    "users",
    {
        id: uuid().defaultRandom().primaryKey(),
        username: text().notNull(),
        usernameNormalized: text("username_normalized").notNull(),
        displayName: text("display_name"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        disabledAt: timestamp("disabled_at", { withTimezone: true }),
    },
    (table) => {
        return [
            uniqueIndex("users_username_normalized_unique").on(
                table.usernameNormalized,
            ),
        ];
    },
);

export const userEmails = pgTable(
    "user_emails",
    {
        id: uuid().defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        email: text().notNull(),
        emailNormalized: text("email_normalized").notNull(),
        verifiedAt: timestamp("verified_at", { withTimezone: true }),
        isPrimary: boolean("is_primary").default(false).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => {
        return [
            uniqueIndex("user_emails_email_normalized_unique").on(
                table.emailNormalized,
            ),
            uniqueIndex("one_primary_email_per_user")
                .on(table.userId)
                .where(sql`${table.isPrimary}`),
        ];
    },
);

export const passwordCredentials = pgTable("password_credentials", {
    userId: uuid("user_id")
        .primaryKey()
        .references(() => users.id, { onDelete: "cascade" }),
    passwordHash: text("password_hash").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

export const webauthnCredentials = pgTable(
    "webauthn_credentials",
    {
        id: uuid().defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        credentialId: bytea("credential_id").notNull(),
        publicKey: bytea("public_key").notNull(),
        counter: bigint({ mode: "bigint" }).default(sql`0`).notNull(),
        transports: text().array().default(sql`'{}'::text[]`).notNull(),
        deviceType: text("device_type").notNull(),
        backedUp: boolean("backed_up").default(false).notNull(),
        name: text().default("Passkey").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    },
    (table) => {
        return [
            uniqueIndex("webauthn_credentials_credential_id_unique").on(
                table.credentialId,
            ),
            check(
                "webauthn_credentials_counter_check",
                sql`${table.counter} >= 0`,
            ),
        ];
    },
);

export const totpCredentials = pgTable("totp_credentials", {
    userId: uuid("user_id")
        .primaryKey()
        .references(() => users.id, { onDelete: "cascade" }),
    secretEncrypted: bytea("secret_encrypted").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    lastCounter: bigint("last_counter", { mode: "bigint" }),
    createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

export const recoveryCodes = pgTable(
    "recovery_codes",
    {
        id: uuid().defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        codeHash: text("code_hash").notNull(),
        usedAt: timestamp("used_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => {
        return [
            uniqueIndex("recovery_codes_code_hash_unique").on(table.codeHash),
        ];
    },
);

export const sessions = pgTable(
    "sessions",
    {
        id: uuid().defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        secretHash: text("secret_hash").notNull(),
        csrfHash: text("csrf_hash").notNull(),
        userAgent: text("user_agent"),
        ipAddress: inet("ip_address"),
        recentAuthAt: timestamp("recent_auth_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        revokedAt: timestamp("revoked_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => {
        return [
            uniqueIndex("sessions_secret_hash_unique").on(table.secretHash),
        ];
    },
);

export const authChallenges = pgTable(
    "auth_challenges",
    {
        id: uuid().defaultRandom().primaryKey(),
        userId: uuid("user_id").references(() => users.id, {
            onDelete: "cascade",
        }),
        kind: text().notNull(),
        challengeHash: text("challenge_hash").notNull(),
        payload: jsonb()
            .$type<Record<string, unknown>>()
            .default(sql`'{}'::jsonb`)
            .notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        usedAt: timestamp("used_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => {
        return [
            uniqueIndex("auth_challenges_challenge_hash_unique").on(
                table.challengeHash,
            ),
        ];
    },
);

export const emailVerificationTokens = pgTable(
    "email_verification_tokens",
    {
        id: uuid().defaultRandom().primaryKey(),
        emailId: uuid("email_id")
            .notNull()
            .references(() => userEmails.id, { onDelete: "cascade" }),
        tokenHash: text("token_hash").notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        usedAt: timestamp("used_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => {
        return [
            uniqueIndex("email_verification_tokens_token_hash_unique").on(
                table.tokenHash,
            ),
        ];
    },
);

export const passwordResetTokens = pgTable(
    "password_reset_tokens",
    {
        id: uuid().defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        tokenHash: text("token_hash").notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        usedAt: timestamp("used_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => {
        return [
            uniqueIndex("password_reset_tokens_token_hash_unique").on(
                table.tokenHash,
            ),
        ];
    },
);

export const accessTokens = pgTable(
    "access_tokens",
    {
        id: uuid().defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        name: text().notNull(),
        tokenPrefix: text("token_prefix").notNull(),
        tokenHash: text("token_hash").notNull(),
        tokenType: text("token_type").notNull(),
        packageRestrictions: text("package_restrictions")
            .array()
            .default(sql`'{}'::text[]`)
            .notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }),
        revokedAt: timestamp("revoked_at", { withTimezone: true }),
        lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => {
        return [
            uniqueIndex("access_tokens_token_hash_unique").on(table.tokenHash),
            check(
                "access_tokens_token_type_check",
                sql`${table.tokenType} IN ('personal', 'automation')`,
            ),
        ];
    },
);

export const tokenScopes = pgTable(
    "token_scopes",
    {
        tokenId: uuid("token_id")
            .notNull()
            .references(() => accessTokens.id, { onDelete: "cascade" }),
        scope: text().notNull(),
    },
    (table) => {
        return [primaryKey({ columns: [table.tokenId, table.scope] })];
    },
);

export const securityEvents = pgTable(
    "security_events",
    {
        id: uuid().defaultRandom().primaryKey(),
        userId: uuid("user_id").references(() => users.id, {
            onDelete: "set null",
        }),
        kind: text().notNull(),
        requestId: text("request_id"),
        ipAddress: inet("ip_address"),
        metadata: jsonb()
            .$type<Record<string, unknown>>()
            .default(sql`'{}'::jsonb`)
            .notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => {
        return [
            index("security_events_user_time_index").on(
                table.userId,
                table.createdAt,
            ),
        ];
    },
);
