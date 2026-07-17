import { Elysia, t } from "elysia";
import type { RegistryServices } from "../services/container.ts";
import { webhookEventNames } from "../services/webhook-service.ts";

const event = t.Union(
    webhookEventNames.map((name) => {
        return t.Literal(name);
    }),
);

const webhookBody = t.Object({
    url: t.String({ format: "uri", maxLength: 2_048 }),
    events: t.Array(event, { minItems: 1, uniqueItems: true }),
});

function options(operationId: string, summary: string) {
    return {
        detail: {
            operationId,
            summary,
            description: summary,
            tags: ["Webhooks"],
            security: [{ bearerAuth: [] }],
        },
    };
}

export function webhookRoutes(services: RegistryServices) {
    return new Elysia({ name: "registry-webhook-routes" })
        .post(
            "/v1/packages/:packageName/webhooks",
            async ({ request, params, body, set }) => {
                const principal = await services.auth.authenticate(request);

                const webhook = await services.webhooks.create(
                    principal,
                    { packageName: params.packageName },
                    body,
                );

                set.status = 201;

                return webhook;
            },
            {
                params: t.Object({ packageName: t.String() }),
                body: webhookBody,
                ...options("createPackageWebhook", "Create a package webhook"),
            },
        )
        .get(
            "/v1/packages/:packageName/webhooks",
            async ({ request, params }) => {
                const principal = await services.auth.authenticate(request);

                return {
                    items: await services.webhooks.list(principal, {
                        packageName: params.packageName,
                    }),
                };
            },
            {
                params: t.Object({ packageName: t.String() }),
                ...options("listPackageWebhooks", "List package webhooks"),
            },
        )
        .delete(
            "/v1/packages/:packageName/webhooks/:webhookId",
            async ({ request, params, set }) => {
                const principal = await services.auth.authenticate(request);

                await services.webhooks.remove(
                    principal,
                    { packageName: params.packageName },
                    params.webhookId,
                );

                set.status = 204;
            },
            {
                params: t.Object({
                    packageName: t.String(),
                    webhookId: t.String({ format: "uuid" }),
                }),
                ...options("deletePackageWebhook", "Delete a package webhook"),
            },
        )
        .post(
            "/v1/packages/:packageName/webhooks/:webhookId/test",
            async ({ request, params, set }) => {
                const principal = await services.auth.authenticate(request);

                const delivery = await services.webhooks.test(
                    principal,
                    { packageName: params.packageName },
                    params.webhookId,
                );

                set.status = 202;

                return delivery;
            },
            {
                params: t.Object({
                    packageName: t.String(),
                    webhookId: t.String({ format: "uuid" }),
                }),
                ...options(
                    "testPackageWebhook",
                    "Queue a package webhook test",
                ),
            },
        )
        .get(
            "/v1/packages/:packageName/webhooks/:webhookId/deliveries",
            async ({ request, params }) => {
                const principal = await services.auth.authenticate(request);

                return {
                    items: await services.webhooks.deliveries(
                        principal,
                        { packageName: params.packageName },
                        params.webhookId,
                    ),
                };
            },
            {
                params: t.Object({
                    packageName: t.String(),
                    webhookId: t.String({ format: "uuid" }),
                }),
                ...options(
                    "listPackageWebhookDeliveries",
                    "List package webhook deliveries",
                ),
            },
        )
        .post(
            "/v1/packages/:packageName/webhooks/:webhookId/deliveries/:deliveryId/retry",
            async ({ request, params, set }) => {
                const principal = await services.auth.authenticate(request);

                const delivery = await services.webhooks.retry(
                    principal,
                    { packageName: params.packageName },
                    params.webhookId,
                    params.deliveryId,
                );

                set.status = 202;

                return delivery;
            },
            {
                params: t.Object({
                    packageName: t.String(),
                    webhookId: t.String({ format: "uuid" }),
                    deliveryId: t.String({ format: "uuid" }),
                }),
                ...options(
                    "retryPackageWebhookDelivery",
                    "Retry a package webhook delivery",
                ),
            },
        )
        .post(
            "/v1/orgs/:org/webhooks",
            async ({ request, params, body, set }) => {
                const principal = await services.auth.authenticate(request);

                const webhook = await services.webhooks.create(
                    principal,
                    { organizationName: params.org },
                    body,
                );

                set.status = 201;

                return webhook;
            },
            {
                params: t.Object({ org: t.String() }),
                body: webhookBody,
                ...options(
                    "createOrganizationWebhook",
                    "Create an organization webhook",
                ),
            },
        )
        .get(
            "/v1/orgs/:org/webhooks",
            async ({ request, params }) => {
                const principal = await services.auth.authenticate(request);

                return {
                    items: await services.webhooks.list(principal, {
                        organizationName: params.org,
                    }),
                };
            },
            {
                params: t.Object({ org: t.String() }),
                ...options(
                    "listOrganizationWebhooks",
                    "List organization webhooks",
                ),
            },
        )
        .delete(
            "/v1/orgs/:org/webhooks/:webhookId",
            async ({ request, params, set }) => {
                const principal = await services.auth.authenticate(request);

                await services.webhooks.remove(
                    principal,
                    { organizationName: params.org },
                    params.webhookId,
                );

                set.status = 204;
            },
            {
                params: t.Object({
                    org: t.String(),
                    webhookId: t.String({ format: "uuid" }),
                }),
                ...options(
                    "deleteOrganizationWebhook",
                    "Delete an organization webhook",
                ),
            },
        );
}
