import { sql } from "drizzle-orm";
import {
    boolean,
    index,
    integer,
    jsonb,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { accessTokens, bytea, users } from "./schema-auth.ts";
import { organizations } from "./schema-organizations.ts";
import { packages } from "./schema-packages.ts";

export const webhooks = pgTable("webhooks", {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
        onDelete: "cascade",
    }),
    packageId: uuid("package_id").references(() => packages.id, {
        onDelete: "cascade",
    }),
    url: text().notNull(),
    secretHash: text("secret_hash").notNull(),
    secretEncrypted: bytea("secret_encrypted").notNull(),
    events: text().array().notNull(),
    active: boolean().default(true).notNull(),
    createdBy: uuid("created_by")
        .notNull()
        .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

export const webhookEvents = pgTable("webhook_events", {
    id: uuid().defaultRandom().primaryKey(),
    eventType: text("event_type").notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
    id: uuid().defaultRandom().primaryKey(),
    webhookId: uuid("webhook_id")
        .notNull()
        .references(() => webhooks.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
        .notNull()
        .references(() => webhookEvents.id, { onDelete: "cascade" }),
    attempt: integer().default(0).notNull(),
    status: text().default("pending").notNull(),
    responseStatus: integer("response_status"),
    responseExcerpt: text("response_excerpt"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

export const auditEvents = pgTable(
    "audit_events",
    {
        id: uuid().defaultRandom().primaryKey(),
        actorUserId: uuid("actor_user_id").references(() => users.id, {
            onDelete: "set null",
        }),
        actorTokenId: uuid("actor_token_id").references(() => accessTokens.id, {
            onDelete: "set null",
        }),
        organizationId: uuid("organization_id").references(
            () => organizations.id,
            { onDelete: "set null" },
        ),
        packageId: uuid("package_id").references(() => packages.id, {
            onDelete: "set null",
        }),
        action: text().notNull(),
        requestId: text("request_id"),
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
            index("audit_org_time_index").on(
                table.organizationId,
                table.createdAt.desc(),
            ),
        ];
    },
);

export const abuseReports = pgTable("abuse_reports", {
    id: uuid().defaultRandom().primaryKey(),
    reporterId: uuid("reporter_id").references(() => users.id, {
        onDelete: "set null",
    }),
    packageId: uuid("package_id").references(() => packages.id, {
        onDelete: "set null",
    }),
    reason: text().notNull(),
    details: text().notNull(),
    status: text().default("open").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

export const moderationActions = pgTable("moderation_actions", {
    id: uuid().defaultRandom().primaryKey(),
    moderatorId: uuid("moderator_id")
        .notNull()
        .references(() => users.id),
    reportId: uuid("report_id").references(() => abuseReports.id),
    packageId: uuid("package_id").references(() => packages.id),
    action: text().notNull(),
    reason: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

export const idempotencyKeys = pgTable(
    "idempotency_keys",
    {
        principalKey: text("principal_key").notNull(),
        idempotencyKey: text("idempotency_key").notNull(),
        requestHash: text("request_hash").notNull(),
        responseStatus: integer("response_status"),
        responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    },
    (table) => {
        return [
            primaryKey({
                columns: [table.principalKey, table.idempotencyKey],
            }),
        ];
    },
);

export const outboxEvents = pgTable(
    "outbox_events",
    {
        id: uuid().defaultRandom().primaryKey(),
        topic: text().notNull(),
        payload: jsonb().$type<Record<string, unknown>>().notNull(),
        availableAt: timestamp("available_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        processedAt: timestamp("processed_at", { withTimezone: true }),
        attempts: integer().default(0).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => {
        return [
            index("outbox_ready_index")
                .on(table.availableAt)
                .where(sql`${table.processedAt} IS NULL`),
        ];
    },
);

export const jobs = pgTable(
    "jobs",
    {
        id: uuid().defaultRandom().primaryKey(),
        kind: text().notNull(),
        payload: jsonb().$type<Record<string, unknown>>().notNull(),
        state: text().default("pending").notNull(),
        availableAt: timestamp("available_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        lockedAt: timestamp("locked_at", { withTimezone: true }),
        lockedBy: text("locked_by"),
        attempts: integer().default(0).notNull(),
        lastError: text("last_error"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => {
        return [
            index("jobs_ready_index")
                .on(table.availableAt)
                .where(sql`${table.state} = 'pending'`),
        ];
    },
);
