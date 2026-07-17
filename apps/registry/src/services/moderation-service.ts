import { and, desc, eq, isNull } from "drizzle-orm";
import type { RegistryServerConfig } from "../config/types.ts";
import type { RegistryDatabase } from "../database/client.ts";
import {
    abuseReports,
    auditEvents,
    moderationActions,
    outboxEvents,
    packages,
    users,
} from "../database/schema.ts";
import { RegistryHttpError } from "../middleware/errors.ts";
import { normalizePackageName } from "../security/names.ts";
import type { AuthPrincipal } from "./auth-service.ts";

export type ModerationDecision =
    | "quarantine"
    | "restore"
    | "resolve"
    | "dismiss";

/** Keeps administrative authorization and moderation transitions in one boundary. */
export class ModerationService {
    readonly #database: RegistryDatabase;

    readonly #config: RegistryServerConfig;

    constructor(database: RegistryDatabase, config: RegistryServerConfig) {
        this.#database = database;
        this.#config = config;
    }

    async report(
        principal: AuthPrincipal,
        input: {
            packageName: string;
            reason: string;
            details: string;
        },
    ) {
        let normalizedName: string;

        try {
            normalizedName = normalizePackageName(input.packageName);
        } catch {
            throw new RegistryHttpError(
                "PACKAGE_NOT_FOUND",
                404,
                "Package was not found.",
            );
        }

        const [packageRecord] = await this.#database
            .select({ id: packages.id })
            .from(packages)
            .where(
                and(
                    eq(packages.nameNormalized, normalizedName),
                    isNull(packages.deletedAt),
                ),
            )
            .limit(1);

        if (packageRecord === undefined) {
            throw new RegistryHttpError(
                "PACKAGE_NOT_FOUND",
                404,
                "Package was not found.",
            );
        }

        const [created] = await this.#database
            .insert(abuseReports)
            .values({
                reporterId: principal.userId,
                packageId: packageRecord.id,
                reason: input.reason,
                details: input.details,
            })
            .returning();

        return created;
    }

    async reports(principal: AuthPrincipal, status?: string) {
        await this.requireAdministrator(principal);

        return this.#database
            .select({
                id: abuseReports.id,
                packageId: abuseReports.packageId,
                reporterId: abuseReports.reporterId,
                reason: abuseReports.reason,
                details: abuseReports.details,
                status: abuseReports.status,
                createdAt: abuseReports.createdAt,
            })
            .from(abuseReports)
            .where(
                status === undefined
                    ? undefined
                    : eq(abuseReports.status, status),
            )
            .orderBy(desc(abuseReports.createdAt))
            .limit(100);
    }

    async actions(principal: AuthPrincipal) {
        await this.requireAdministrator(principal);

        return this.#database
            .select()
            .from(moderationActions)
            .orderBy(desc(moderationActions.createdAt))
            .limit(100);
    }

    async moderate(
        principal: AuthPrincipal,
        reportId: string,
        decision: ModerationDecision,
        reason: string,
    ) {
        await this.requireAdministrator(principal);

        const [report] = await this.#database
            .select()
            .from(abuseReports)
            .where(eq(abuseReports.id, reportId))
            .limit(1);

        if (report === undefined) {
            throw new RegistryHttpError(
                "RESOURCE_NOT_FOUND",
                404,
                "Abuse report was not found.",
            );
        }

        await this.#database.transaction(async (transaction) => {
            await transaction
                .update(abuseReports)
                .set({
                    status:
                        decision === "dismiss"
                            ? "dismissed"
                            : decision === "quarantine"
                              ? "actioned"
                              : "resolved",
                })
                .where(eq(abuseReports.id, report.id));

            const [action] = await transaction
                .insert(moderationActions)
                .values({
                    moderatorId: principal.userId,
                    reportId: report.id,
                    packageId: report.packageId,
                    action: decision,
                    reason,
                })
                .returning();

            if (report.packageId !== null && decision === "quarantine") {
                await transaction
                    .update(packages)
                    .set({
                        quarantinedAt: new Date(),
                        quarantineReason: reason,
                    })
                    .where(eq(packages.id, report.packageId));

                await transaction.insert(outboxEvents).values({
                    topic: "webhook.security.package_quarantined",
                    payload: {
                        eventType: "security.package_quarantined",
                        packageId: report.packageId,
                        reason,
                    },
                });
            }

            if (report.packageId !== null && decision === "restore") {
                await transaction
                    .update(packages)
                    .set({ quarantinedAt: null, quarantineReason: null })
                    .where(eq(packages.id, report.packageId));
            }

            await transaction.insert(auditEvents).values({
                actorUserId: principal.userId,
                actorTokenId: principal.tokenId,
                packageId: report.packageId,
                action: `moderation.${decision}`,
                metadata: { reportId: report.id, actionId: action?.id },
            });
        });

        return { reportId, decision, reason };
    }

    private async requireAdministrator(
        principal: AuthPrincipal,
    ): Promise<void> {
        const [user] = await this.#database
            .select({ username: users.usernameNormalized })
            .from(users)
            .where(eq(users.id, principal.userId))
            .limit(1);

        const allowed =
            principal.scopes.includes("registry:admin") ||
            (user !== undefined &&
                this.#config.administration.usernames.includes(user.username));

        if (!allowed) {
            throw new RegistryHttpError(
                "RESOURCE_NOT_FOUND",
                404,
                "Resource was not found.",
            );
        }
    }
}
