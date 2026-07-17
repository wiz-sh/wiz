import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { RegistryServerConfig } from "../config/types.ts";
import type { RegistryDatabase } from "../database/client.ts";
import {
    organizationMembers,
    organizations,
    packages,
    webhookDeliveries,
    webhookEvents,
    webhooks,
} from "../database/schema.ts";
import { RegistryHttpError } from "../middleware/errors.ts";
import {
    decryptSecret,
    encryptSecret,
    hashSecret,
    randomSecret,
} from "../security/crypto.ts";
import { normalizeIdentity, normalizePackageName } from "../security/names.ts";
import type { AuthPrincipal } from "./auth-service.ts";

export const webhookEventNames = [
    "package.created",
    "package.updated",
    "package.published",
    "package.deprecated",
    "package.unpublished",
    "package.transferred",
    "package.visibility_changed",
    "org.member_added",
    "org.member_removed",
    "org.invitation_created",
    "security.package_quarantined",
] as const;

export type WebhookEventName = (typeof webhookEventNames)[number];

type WebhookScope = { packageName: string } | { organizationName: string };

function isPrivateAddress(address: string): boolean {
    if (address === "::1" || address === "::" || address.startsWith("fe80:")) {
        return true;
    }

    if (address.startsWith("fc") || address.startsWith("fd")) {
        return true;
    }

    const octets = address.split(".").map(Number);

    if (octets.length !== 4 || octets.some(Number.isNaN)) {
        return false;
    }

    const [first = 0, second = 0] = octets;

    return (
        first === 0 ||
        first === 10 ||
        first === 127 ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) ||
        first >= 224
    );
}

/** Rejects webhook destinations that could reach an internal control plane. */
export async function validateWebhookDestination(value: string): Promise<URL> {
    let url: URL;

    try {
        url = new URL(value);
    } catch {
        throw new RegistryHttpError(
            "VALIDATION_FAILED",
            400,
            "Webhook URL is invalid.",
        );
    }

    if (
        url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        url.port === "0"
    ) {
        throw new RegistryHttpError(
            "VALIDATION_FAILED",
            400,
            "Webhook URLs must use HTTPS and must not contain credentials.",
        );
    }

    const normalizedHost = url.hostname
        .toLowerCase()
        .replace(/\.$/, "")
        .replace(/^\[|\]$/g, "");

    if (
        normalizedHost === "localhost" ||
        normalizedHost.endsWith(".localhost") ||
        normalizedHost.endsWith(".local") ||
        normalizedHost.endsWith(".internal")
    ) {
        throw new RegistryHttpError(
            "VALIDATION_FAILED",
            400,
            "Webhook URL resolves to a private destination.",
        );
    }

    if (isIP(normalizedHost) !== 0 && isPrivateAddress(normalizedHost)) {
        throw new RegistryHttpError(
            "VALIDATION_FAILED",
            400,
            "Webhook URL resolves to a private destination.",
        );
    }

    return url;
}

export async function assertWebhookDnsIsPublic(url: URL): Promise<void> {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });

    if (
        addresses.length === 0 ||
        addresses.some(({ address }) => isPrivateAddress(address))
    ) {
        throw new Error("Webhook destination resolved to a private address");
    }
}

function publicWebhook(record: typeof webhooks.$inferSelect) {
    return {
        id: record.id,
        url: record.url,
        events: record.events,
        active: record.active,
        createdAt: record.createdAt.toISOString(),
    };
}

/** Centralizes webhook ownership, secret lifecycle, and delivery inspection. */
export class WebhookService {
    readonly #database: RegistryDatabase;

    readonly #config: RegistryServerConfig;

    constructor(database: RegistryDatabase, config: RegistryServerConfig) {
        this.#database = database;
        this.#config = config;
    }

    async create(
        principal: AuthPrincipal,
        scope: WebhookScope,
        input: {
            url: string;
            events: readonly WebhookEventName[];
        },
    ) {
        const target = await this.authorizeScope(principal, scope);

        const url = await validateWebhookDestination(input.url);

        const uniqueEvents = [...new Set(input.events)];

        if (uniqueEvents.length === 0) {
            throw new RegistryHttpError(
                "VALIDATION_FAILED",
                400,
                "At least one webhook event is required.",
            );
        }

        const secret = `wiz_whsec_${randomSecret()}`;

        const [created] = await this.#database
            .insert(webhooks)
            .values({
                ...target,
                url: url.toString(),
                events: uniqueEvents,
                secretHash: await hashSecret(secret, this.#config.tokenPepper),
                secretEncrypted: await encryptSecret(
                    secret,
                    this.#config.sessionSecret,
                ),
                createdBy: principal.userId,
            })
            .returning();

        if (created === undefined) {
            throw new Error("Webhook insert did not return a row");
        }

        return { ...publicWebhook(created), secret };
    }

    async list(principal: AuthPrincipal, scope: WebhookScope) {
        const target = await this.authorizeScope(principal, scope);

        const condition =
            target.packageId === undefined
                ? eq(webhooks.organizationId, target.organizationId as string)
                : eq(webhooks.packageId, target.packageId);

        const records = await this.#database
            .select()
            .from(webhooks)
            .where(condition)
            .orderBy(desc(webhooks.createdAt));

        return records.map(publicWebhook);
    }

    async remove(
        principal: AuthPrincipal,
        scope: WebhookScope,
        webhookId: string,
    ): Promise<void> {
        const record = await this.findOwned(principal, scope, webhookId);

        await this.#database.delete(webhooks).where(eq(webhooks.id, record.id));
    }

    async deliveries(
        principal: AuthPrincipal,
        scope: WebhookScope,
        webhookId: string,
    ) {
        const record = await this.findOwned(principal, scope, webhookId);

        return this.#database
            .select({
                id: webhookDeliveries.id,
                eventId: webhookDeliveries.eventId,
                event: webhookEvents.eventType,
                attempt: webhookDeliveries.attempt,
                status: webhookDeliveries.status,
                responseStatus: webhookDeliveries.responseStatus,
                responseExcerpt: webhookDeliveries.responseExcerpt,
                createdAt: webhookDeliveries.createdAt,
            })
            .from(webhookDeliveries)
            .innerJoin(
                webhookEvents,
                eq(webhookEvents.id, webhookDeliveries.eventId),
            )
            .where(eq(webhookDeliveries.webhookId, record.id))
            .orderBy(desc(webhookDeliveries.createdAt))
            .limit(100);
    }

    async test(
        principal: AuthPrincipal,
        scope: WebhookScope,
        webhookId: string,
    ) {
        const record = await this.findOwned(principal, scope, webhookId);

        const [event] = await this.#database
            .insert(webhookEvents)
            .values({
                eventType: "webhook.test",
                payload: {
                    webhookId: record.id,
                    test: true,
                },
            })
            .returning();

        if (event === undefined) {
            throw new Error("Webhook test event insert did not return a row");
        }

        const [delivery] = await this.#database
            .insert(webhookDeliveries)
            .values({ webhookId: record.id, eventId: event.id })
            .returning();

        return delivery;
    }

    async retry(
        principal: AuthPrincipal,
        scope: WebhookScope,
        webhookId: string,
        deliveryId: string,
    ) {
        const record = await this.findOwned(principal, scope, webhookId);

        const [delivery] = await this.#database
            .update(webhookDeliveries)
            .set({
                status: "pending",
                nextAttemptAt: new Date(),
                responseStatus: null,
                responseExcerpt: null,
            })
            .where(
                and(
                    eq(webhookDeliveries.id, deliveryId),
                    eq(webhookDeliveries.webhookId, record.id),
                ),
            )
            .returning();

        if (delivery === undefined) {
            throw new RegistryHttpError(
                "RESOURCE_NOT_FOUND",
                404,
                "Webhook delivery was not found.",
            );
        }

        return delivery;
    }

    private async findOwned(
        principal: AuthPrincipal,
        scope: WebhookScope,
        webhookId: string,
    ) {
        const target = await this.authorizeScope(principal, scope);

        const condition =
            target.packageId === undefined
                ? eq(webhooks.organizationId, target.organizationId as string)
                : eq(webhooks.packageId, target.packageId);

        const [record] = await this.#database
            .select()
            .from(webhooks)
            .where(and(eq(webhooks.id, webhookId), condition))
            .limit(1);

        if (record === undefined) {
            throw new RegistryHttpError(
                "RESOURCE_NOT_FOUND",
                404,
                "Webhook was not found.",
            );
        }

        return record;
    }

    private async authorizeScope(
        principal: AuthPrincipal,
        scope: WebhookScope,
    ): Promise<{ packageId?: string; organizationId?: string }> {
        if ("packageName" in scope) {
            const normalized = normalizePackageName(scope.packageName);

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

            if (record.ownerUserId === principal.userId) {
                return { packageId: record.id };
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
                            or(
                                eq(organizationMembers.role, "owner"),
                                eq(organizationMembers.role, "admin"),
                            ),
                        ),
                    )
                    .limit(1);

                if (membership !== undefined) {
                    return { packageId: record.id };
                }
            }

            throw new RegistryHttpError(
                "INSUFFICIENT_PERMISSION",
                403,
                "Package administrator permission is required.",
            );
        }

        const [organization] = await this.#database
            .select({ id: organizations.id })
            .from(organizations)
            .where(
                and(
                    eq(
                        organizations.nameNormalized,
                        normalizeIdentity(scope.organizationName),
                    ),
                    isNull(organizations.deletedAt),
                ),
            )
            .limit(1);

        if (organization === undefined) {
            throw new RegistryHttpError(
                "ORG_NOT_FOUND",
                404,
                "Organization was not found.",
            );
        }

        const [membership] = await this.#database
            .select({ role: organizationMembers.role })
            .from(organizationMembers)
            .where(
                and(
                    eq(organizationMembers.organizationId, organization.id),
                    eq(organizationMembers.userId, principal.userId),
                    or(
                        eq(organizationMembers.role, "owner"),
                        eq(organizationMembers.role, "admin"),
                    ),
                ),
            )
            .limit(1);

        if (membership === undefined) {
            throw new RegistryHttpError(
                "INSUFFICIENT_PERMISSION",
                403,
                "Organization administrator permission is required.",
            );
        }

        return { organizationId: organization.id };
    }
}

export function webhookSignature(
    secret: string,
    timestamp: string,
    body: string,
): string {
    const digest = createHmac("sha256", secret)
        .update(`${timestamp}.${body}`)
        .digest("hex");

    return `sha256=${digest}`;
}

export async function webhookSecret(
    record: typeof webhooks.$inferSelect,
    config: RegistryServerConfig,
): Promise<string> {
    return decryptSecret(record.secretEncrypted, config.sessionSecret);
}
