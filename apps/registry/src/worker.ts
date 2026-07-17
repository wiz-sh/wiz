import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { loadRegistryConfig } from "./config/environment.ts";
import type { RegistryServerConfig } from "./config/types.ts";
import { createDatabase, type RegistryDatabase } from "./database/client.ts";
import {
    authChallenges,
    idempotencyKeys,
    jobs,
    outboxEvents,
    packageDownloadRollups,
    passwordResetTokens,
    sessions,
    webhookDeliveries,
    webhookEvents,
    webhooks,
} from "./database/schema.ts";
import {
    assertWebhookDnsIsPublic,
    validateWebhookDestination,
    webhookSecret,
    webhookSignature,
} from "./services/webhook-service.ts";

export interface MaintenanceResult {
    authChallenges: number;
    idempotencyKeys: number;
    passwordResetTokens: number;
    sessions: number;
}

export interface WorkerBatchResult {
    jobs: number;
    outbox: number;
    webhooks: number;
}

export type WebhookFetch = (
    input: string | URL | Request,
    init?: RequestInit,
) => Promise<Response>;

export type WebhookDestinationCheck = (url: URL) => Promise<void>;

function stringPayload(
    payload: Record<string, unknown>,
    key: string,
): string | undefined {
    const value = payload[key];

    return typeof value === "string" ? value : undefined;
}

/** Claims and executes a bounded batch so one malformed job cannot stop the worker. */
export async function processJobs(
    database: RegistryDatabase,
    workerId: string,
    now = new Date(),
): Promise<number> {
    const pending = await database
        .select()
        .from(jobs)
        .where(
            and(
                eq(jobs.state, "pending"),
                lt(jobs.availableAt, new Date(now.getTime() + 1)),
            ),
        )
        .limit(100);

    let processed = 0;

    for (const job of pending) {
        const [claimed] = await database
            .update(jobs)
            .set({
                state: "running",
                lockedAt: now,
                lockedBy: workerId,
                attempts: job.attempts + 1,
            })
            .where(and(eq(jobs.id, job.id), eq(jobs.state, "pending")))
            .returning({ id: jobs.id });

        if (claimed === undefined) {
            continue;
        }

        try {
            if (job.kind === "download.rollup") {
                const packageId = stringPayload(job.payload, "packageId");

                const versionId = stringPayload(job.payload, "versionId");

                if (packageId === undefined || versionId === undefined) {
                    throw new Error("Download rollup job payload is invalid");
                }

                const day = now.toISOString().slice(0, 10);

                await database
                    .insert(packageDownloadRollups)
                    .values({
                        packageId,
                        versionId,
                        day,
                        downloads: 1n,
                    })
                    .onConflictDoUpdate({
                        target: [
                            packageDownloadRollups.packageId,
                            packageDownloadRollups.versionId,
                            packageDownloadRollups.day,
                        ],
                        set: {
                            downloads: sql`${packageDownloadRollups.downloads} + 1`,
                        },
                    });
            }

            await database
                .update(jobs)
                .set({ state: "complete", lastError: null })
                .where(eq(jobs.id, job.id));

            processed += 1;
        } catch (err) {
            await database
                .update(jobs)
                .set({
                    state: job.attempts >= 4 ? "failed" : "pending",
                    lastError: err instanceof Error ? err.message : String(err),
                    availableAt: new Date(
                        now.getTime() + 2 ** job.attempts * 1_000,
                    ),
                    lockedAt: null,
                    lockedBy: null,
                })
                .where(eq(jobs.id, job.id));
        }
    }

    return processed;
}

/** Materializes committed domain events into durable webhook deliveries. */
export async function processOutbox(
    database: RegistryDatabase,
    now = new Date(),
): Promise<number> {
    const pending = await database
        .select()
        .from(outboxEvents)
        .where(
            and(
                isNull(outboxEvents.processedAt),
                lt(outboxEvents.availableAt, new Date(now.getTime() + 1)),
            ),
        )
        .limit(100);

    let processed = 0;

    for (const outbox of pending) {
        const eventType = stringPayload(outbox.payload, "eventType");

        const packageId = stringPayload(outbox.payload, "packageId");

        const organizationId = stringPayload(outbox.payload, "organizationId");

        if (eventType === undefined) {
            await database
                .update(outboxEvents)
                .set({
                    processedAt: now,
                    attempts: outbox.attempts + 1,
                })
                .where(
                    and(
                        eq(outboxEvents.id, outbox.id),
                        isNull(outboxEvents.processedAt),
                    ),
                );

            continue;
        }

        const scopeCondition =
            packageId !== undefined && organizationId !== undefined
                ? or(
                      eq(webhooks.packageId, packageId),
                      eq(webhooks.organizationId, organizationId),
                  )
                : packageId !== undefined
                  ? eq(webhooks.packageId, packageId)
                  : organizationId !== undefined
                    ? eq(webhooks.organizationId, organizationId)
                    : undefined;

        const subscriptions =
            scopeCondition === undefined
                ? []
                : await database
                      .select()
                      .from(webhooks)
                      .where(and(eq(webhooks.active, true), scopeCondition));

        const matching = subscriptions.filter((subscription) => {
            return subscription.events.includes(eventType);
        });

        await database.transaction(async (transaction) => {
            const [event] = await transaction
                .insert(webhookEvents)
                .values({ eventType, payload: outbox.payload })
                .returning({ id: webhookEvents.id });

            if (event === undefined) {
                throw new Error("Webhook event insert did not return a row");
            }

            if (matching.length > 0) {
                await transaction.insert(webhookDeliveries).values(
                    matching.map((subscription) => {
                        return {
                            webhookId: subscription.id,
                            eventId: event.id,
                        };
                    }),
                );
            }

            await transaction
                .update(outboxEvents)
                .set({
                    processedAt: now,
                    attempts: outbox.attempts + 1,
                })
                .where(
                    and(
                        eq(outboxEvents.id, outbox.id),
                        isNull(outboxEvents.processedAt),
                    ),
                );
        });

        processed += 1;
    }

    return processed;
}

async function responseExcerpt(
    response: Response,
    maximum = 4_096,
): Promise<string> {
    if (response.body === null) {
        return "";
    }

    const reader = response.body.getReader();

    const chunks: Uint8Array[] = [];

    let length = 0;

    while (length < maximum) {
        const result = await reader.read();

        if (result.done) {
            break;
        }

        const remaining = maximum - length;

        const chunk = result.value.slice(0, remaining);

        chunks.push(chunk);
        length += chunk.byteLength;

        if (result.value.byteLength > remaining) {
            await reader.cancel();

            break;
        }
    }

    const bytes = new Uint8Array(length);

    let offset = 0;

    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }

    return new TextDecoder().decode(bytes);
}

/** Signs and sends pending webhooks with bounded I/O and exponential retry. */
export async function processWebhookDeliveries(
    database: RegistryDatabase,
    config: RegistryServerConfig,
    fetcher: WebhookFetch = fetch,
    now = new Date(),
    checkDestination: WebhookDestinationCheck = assertWebhookDnsIsPublic,
): Promise<number> {
    const pending = await database
        .select({
            delivery: webhookDeliveries,
            webhook: webhooks,
            event: webhookEvents,
        })
        .from(webhookDeliveries)
        .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
        .innerJoin(
            webhookEvents,
            eq(webhookEvents.id, webhookDeliveries.eventId),
        )
        .where(
            and(
                eq(webhookDeliveries.status, "pending"),
                eq(webhooks.active, true),
                or(
                    isNull(webhookDeliveries.nextAttemptAt),
                    lt(
                        webhookDeliveries.nextAttemptAt,
                        new Date(now.getTime() + 1),
                    ),
                ),
            ),
        )
        .limit(50);

    let processed = 0;

    for (const record of pending) {
        const attempt = record.delivery.attempt + 1;

        try {
            const url = await validateWebhookDestination(record.webhook.url);

            await checkDestination(url);

            const body = JSON.stringify({
                id: record.event.id,
                type: record.event.eventType,
                createdAt: record.event.createdAt.toISOString(),
                data: record.event.payload,
            });

            const timestamp = Math.floor(now.getTime() / 1_000).toString();

            const secret = await webhookSecret(record.webhook, config);

            const response = await fetcher(url, {
                method: "POST",
                redirect: "manual",
                signal: AbortSignal.timeout(10_000),
                headers: {
                    "content-type": "application/json",
                    "user-agent": "Wiz-Registry-Webhook/1.0",
                    "x-wiz-event": record.event.eventType,
                    "x-wiz-event-id": record.event.id,
                    "x-wiz-timestamp": timestamp,
                    "x-wiz-signature": webhookSignature(
                        secret,
                        timestamp,
                        body,
                    ),
                },
                body,
            });

            const excerpt = await responseExcerpt(response);

            if (response.status < 200 || response.status >= 300) {
                throw Object.assign(
                    new Error(`Webhook returned HTTP ${response.status}`),
                    { responseStatus: response.status, excerpt },
                );
            }

            await database
                .update(webhookDeliveries)
                .set({
                    attempt,
                    status: "delivered",
                    responseStatus: response.status,
                    responseExcerpt: excerpt,
                    nextAttemptAt: null,
                })
                .where(eq(webhookDeliveries.id, record.delivery.id));

            processed += 1;
        } catch (err) {
            const error = err as Error & {
                responseStatus?: number;
                excerpt?: string;
            };

            const exhausted = attempt >= 8;

            await database
                .update(webhookDeliveries)
                .set({
                    attempt,
                    status: exhausted ? "failed" : "pending",
                    responseStatus: error.responseStatus ?? null,
                    responseExcerpt:
                        error.excerpt ?? error.message.slice(0, 4_096),
                    nextAttemptAt: exhausted
                        ? null
                        : new Date(now.getTime() + 2 ** attempt * 1_000),
                })
                .where(eq(webhookDeliveries.id, record.delivery.id));
        }
    }

    return processed;
}

export async function runWorkerBatch(
    database: RegistryDatabase,
    config: RegistryServerConfig,
    workerId: string,
): Promise<WorkerBatchResult> {
    const [jobCount, outboxCount, webhookCount] = await Promise.all([
        processJobs(database, workerId),
        processOutbox(database),
        processWebhookDeliveries(database, config),
    ]);

    return {
        jobs: jobCount,
        outbox: outboxCount,
        webhooks: webhookCount,
    };
}

/** Removes expired security state serially to avoid saturating the Bun SQL pool. */
export async function runMaintenance(
    database: RegistryDatabase,
    now = new Date(),
): Promise<MaintenanceResult> {
    const deletedChallenges = await database
        .delete(authChallenges)
        .where(lt(authChallenges.expiresAt, now))
        .returning({ id: authChallenges.id });

    const deletedIdempotencyKeys = await database
        .delete(idempotencyKeys)
        .where(lt(idempotencyKeys.expiresAt, now))
        .returning({ key: idempotencyKeys.idempotencyKey });

    const deletedPasswordResets = await database
        .delete(passwordResetTokens)
        .where(lt(passwordResetTokens.expiresAt, now))
        .returning({ id: passwordResetTokens.id });

    const deletedSessions = await database
        .delete(sessions)
        .where(lt(sessions.expiresAt, now))
        .returning({ id: sessions.id });

    return {
        authChallenges: deletedChallenges.length,
        idempotencyKeys: deletedIdempotencyKeys.length,
        passwordResetTokens: deletedPasswordResets.length,
        sessions: deletedSessions.length,
    };
}

if (import.meta.main) {
    const config = loadRegistryConfig();

    const database = createDatabase(config.databaseUrl);

    const workerId = `worker_${crypto.randomUUID()}`;

    const interval = setInterval(() => {
        void Promise.all([
            runMaintenance(database),
            runWorkerBatch(database, config, workerId),
        ]).catch((err: unknown) => {
            console.error("Registry maintenance failed", err);
        });
    }, 1_000);

    const stop = async (): Promise<void> => {
        clearInterval(interval);

        await database.$client.close();
    };

    process.once("SIGINT", stop);

    process.once("SIGTERM", stop);

    await Promise.all([
        runMaintenance(database),
        runWorkerBatch(database, config, workerId),
    ]);
}
