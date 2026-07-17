import type { RegistryTransport } from "./transport.ts";
import type {
    CursorPage,
    RegistryAbuseReport,
    RegistryModerationAction,
    RegistryRequestOptions,
} from "./types.ts";

export type ModerationDecision =
    | "quarantine"
    | "restore"
    | "resolve"
    | "dismiss";

export class RegistryAdministrationResource {
    constructor(private readonly transport: RegistryTransport) {}

    report(
        input: { packageName: string; reason: string; details: string },
        options: RegistryRequestOptions = {},
    ): Promise<RegistryAbuseReport> {
        return this.transport.request({
            method: "POST",
            path: "/v1/reports",
            body: input,
            ...options,
        });
    }

    reports(
        status?: string,
        options: RegistryRequestOptions = {},
    ): Promise<CursorPage<RegistryAbuseReport>> {
        const query = new URLSearchParams();

        if (status !== undefined) {
            query.set("status", status);
        }

        return this.transport.request({
            path: `/v1/admin/reports${query.size === 0 ? "" : `?${query}`}`,
            ...options,
        });
    }

    moderate(
        reportId: string,
        decision: ModerationDecision,
        reason: string,
        options: RegistryRequestOptions = {},
    ): Promise<{
        reportId: string;
        decision: ModerationDecision;
        reason: string;
    }> {
        return this.transport.request({
            method: "POST",
            path: `/v1/admin/reports/${encodeURIComponent(reportId)}/actions`,
            body: { decision, reason },
            ...options,
        });
    }

    actions(
        options: RegistryRequestOptions = {},
    ): Promise<CursorPage<RegistryModerationAction>> {
        return this.transport.request({
            path: "/v1/admin/moderation-actions",
            ...options,
        });
    }
}
