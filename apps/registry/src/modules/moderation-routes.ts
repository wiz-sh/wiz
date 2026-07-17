import { Elysia, t } from "elysia";
import type { RegistryServices } from "../services/container.ts";

function options(
    operationId: string,
    summary: string,
    tag: "Reports" | "Administration",
) {
    return {
        detail: {
            operationId,
            summary,
            description: summary,
            tags: [tag],
            security: [{ bearerAuth: [] }],
        },
    };
}

export function moderationRoutes(services: RegistryServices) {
    return new Elysia({ name: "registry-moderation-routes" })
        .post(
            "/v1/reports",
            async ({ request, body, set }) => {
                const principal = await services.auth.authenticate(request);

                const report = await services.moderation.report(
                    principal,
                    body,
                );

                set.status = 201;

                return report;
            },
            {
                body: t.Object({
                    packageName: t.String({ minLength: 1, maxLength: 214 }),
                    reason: t.String({ minLength: 1, maxLength: 128 }),
                    details: t.String({ minLength: 1, maxLength: 10_000 }),
                }),
                ...options("createAbuseReport", "Report a package", "Reports"),
            },
        )
        .get(
            "/v1/admin/reports",
            async ({ request, query }) => {
                const principal = await services.auth.authenticate(request);

                return {
                    items: await services.moderation.reports(
                        principal,
                        query.status,
                    ),
                };
            },
            {
                query: t.Object({ status: t.Optional(t.String()) }),
                ...options(
                    "listAbuseReports",
                    "List package abuse reports",
                    "Administration",
                ),
            },
        )
        .post(
            "/v1/admin/reports/:reportId/actions",
            async ({ request, params, body }) => {
                const principal = await services.auth.authenticate(request);

                return services.moderation.moderate(
                    principal,
                    params.reportId,
                    body.decision,
                    body.reason,
                );
            },
            {
                params: t.Object({
                    reportId: t.String({ format: "uuid" }),
                }),
                body: t.Object({
                    decision: t.Union([
                        t.Literal("quarantine"),
                        t.Literal("restore"),
                        t.Literal("resolve"),
                        t.Literal("dismiss"),
                    ]),
                    reason: t.String({ minLength: 1, maxLength: 2_000 }),
                }),
                ...options(
                    "moderateAbuseReport",
                    "Apply a moderation decision",
                    "Administration",
                ),
            },
        )
        .get(
            "/v1/admin/moderation-actions",
            async ({ request }) => {
                const principal = await services.auth.authenticate(request);

                return {
                    items: await services.moderation.actions(principal),
                };
            },
            options(
                "listModerationActions",
                "List moderation actions",
                "Administration",
            ),
        );
}
