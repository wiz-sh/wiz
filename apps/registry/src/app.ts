import { cors } from "@elysia/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia, t } from "elysia";
import type { RegistryServerConfig } from "./config/types.ts";
import { users } from "./database/schema.ts";
import { errorResponse, RegistryHttpError } from "./middleware/errors.ts";
import {
    createRequestContext,
    requestDuration,
} from "./middleware/request-context.ts";
import { authRoutes } from "./modules/auth-routes.ts";
import { moderationRoutes } from "./modules/moderation-routes.ts";
import { organizationRoutes } from "./modules/organization-routes.ts";
import { packageManagementRoutes } from "./modules/package-management-routes.ts";
import { packageRoutes } from "./modules/package-routes.ts";
import { webauthnRoutes } from "./modules/webauthn-routes.ts";
import { webhookRoutes } from "./modules/webhook-routes.ts";
import {
    createTelemetryPlugin,
    recordHttpRequest,
} from "./observability/telemetry.ts";
import {
    createRegistryServices,
    type RegistryServices,
} from "./services/container.ts";

const healthResponse = t.Object({
    status: t.String(),
    database: t.String(),
});

function healthRoute(services: RegistryServices) {
    return async ({ set }: { set: { status?: number | string } }) => {
        try {
            await services.database
                .select({ id: users.id })
                .from(users)
                .limit(1);

            return { status: "ok", database: "connected" };
        } catch {
            set.status = 503;

            return { status: "unavailable", database: "disconnected" };
        }
    };
}

function readyRoute(services: RegistryServices) {
    return async ({ set }: { set: { status?: number | string } }) => {
        try {
            await services.database
                .select({ id: users.id })
                .from(users)
                .limit(1);

            const redisReady = await services.rateLimits.ready();

            if (!redisReady) {
                set.status = 503;

                return { status: "unavailable", database: "connected" };
            }

            return { status: "ok", database: "connected" };
        } catch {
            set.status = 503;

            return { status: "unavailable", database: "disconnected" };
        }
    };
}

const healthOptions = (operationId: string, summary: string) => {
    return {
        response: {
            200: healthResponse,
            503: healthResponse,
        },
        detail: {
            operationId,
            summary,
            description: summary,
            tags: ["Health"],
        },
    };
};

/** Creates the typed HTTP application without opening a socket. */
export function createRegistryApplication(
    config: RegistryServerConfig,
    services: RegistryServices | Pick<RegistryServices, "database" | "mailer">,
) {
    const registryServices =
        "auth" in services
            ? services
            : createRegistryServices(
                  config,
                  services.database,
                  services.mailer,
              );

    return new Elysia({ name: "wiz-registry" })
        .use(createTelemetryPlugin(config.telemetry))
        .use(
            cors({
                origin:
                    config.cors.origins.length === 0
                        ? false
                        : [...config.cors.origins],
                credentials: config.cors.credentials,
                methods: [
                    "GET",
                    "HEAD",
                    "POST",
                    "PUT",
                    "PATCH",
                    "DELETE",
                    "OPTIONS",
                ],
                allowedHeaders: [
                    "Authorization",
                    "Content-Type",
                    "Idempotency-Key",
                    "X-CSRF-Token",
                    "X-Request-ID",
                ],
                exposeHeaders: [
                    "Content-Length",
                    "ETag",
                    "Location",
                    "X-Request-ID",
                ],
                maxAge: config.cors.maxAgeSeconds,
                preflight: true,
            }),
        )
        .use(
            openapi({
                path: "/openapi",
                specPath: "/openapi/json",
                scalar: {
                    theme: "purple",
                    layout: "modern",
                },
                documentation: {
                    info: {
                        title: "Wiz Registry API",
                        version: "1.0.0",
                        description:
                            "Production package registry API for Wiz and typed shell packages.",
                    },
                    servers: [{ url: config.publicUrl }],
                    tags: [
                        { name: "Authentication" },
                        { name: "WebAuthn" },
                        { name: "MFA" },
                        { name: "Users" },
                        { name: "Sessions" },
                        { name: "Tokens" },
                        { name: "Organizations" },
                        { name: "Organization Members" },
                        { name: "Organization Teams" },
                        { name: "Organization Policies" },
                        { name: "Packages" },
                        { name: "Package Versions" },
                        { name: "Publishing" },
                        { name: "Downloads" },
                        { name: "Distribution Tags" },
                        { name: "Search" },
                        { name: "Webhooks" },
                        { name: "Audit Logs" },
                        { name: "Reports" },
                        { name: "Administration" },
                        { name: "Health" },
                    ],
                    components: {
                        securitySchemes: {
                            bearerAuth: {
                                type: "http",
                                scheme: "bearer",
                                bearerFormat: "Wiz access token",
                            },
                            sessionCookie: {
                                type: "apiKey",
                                in: "cookie",
                                name: "wiz_session",
                            },
                        },
                    },
                },
            }),
        )
        .derive(({ request }) => {
            return { requestContext: createRequestContext(request) };
        })
        .onBeforeHandle(async ({ request }) => {
            const url = new URL(request.url);

            if (
                url.pathname === "/health" ||
                url.pathname === "/ready" ||
                url.pathname === "/openapi" ||
                url.pathname === "/openapi/json"
            ) {
                return;
            }

            const client =
                request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
                "direct";

            const authenticationRoute = url.pathname.startsWith("/v1/auth/");

            await registryServices.rateLimits.check(
                `rate:${client}:${authenticationRoute ? "auth" : "api"}`,
                authenticationRoute
                    ? config.rateLimits.authentication
                    : config.rateLimits.api,
                config.rateLimits.windowSeconds,
            );
        })
        .onAfterHandle(({ request, requestContext, responseValue, set }) => {
            set.headers["x-request-id"] = requestContext.requestId;
            set.headers["x-content-type-options"] = "nosniff";
            set.headers["referrer-policy"] = "no-referrer";
            set.headers["permissions-policy"] =
                "camera=(), microphone=(), geolocation=()";

            const status = typeof set.status === "number" ? set.status : 200;

            const durationMs = requestDuration(requestContext);

            const route = new URL(request.url).pathname;

            registryServices.logger.logRequest({
                level:
                    status >= 500 ? "error" : status >= 400 ? "warn" : "info",
                requestId: requestContext.requestId,
                method: request.method,
                route,
                status,
                durationMs,
                message: "HTTP request completed",
                ...(requestContext.clientVersion === undefined
                    ? {}
                    : { clientVersion: requestContext.clientVersion }),
            });

            recordHttpRequest(request.method, route, status, durationMs);

            return responseValue;
        })
        .onError(({ error, set, requestContext }) => {
            const requestId =
                requestContext?.requestId ?? `req_${crypto.randomUUID()}`;

            set.headers["x-request-id"] = requestId;

            const status =
                error instanceof RegistryHttpError
                    ? error.status
                    : error instanceof Error && error.name === "ValidationError"
                      ? 422
                      : 500;

            const durationMs =
                requestContext === undefined
                    ? 0
                    : requestDuration(requestContext);

            registryServices.logger.logRequest({
                level: status >= 500 ? "error" : "warn",
                requestId,
                status,
                durationMs,
                error,
                message: "HTTP request failed",
            });

            recordHttpRequest("UNKNOWN", "unmatched", status, durationMs);

            if (error instanceof RegistryHttpError) {
                set.status = error.status;

                return errorResponse(error, requestId);
            }

            if (error instanceof Error && error.name === "ValidationError") {
                const validation = new RegistryHttpError(
                    "VALIDATION_FAILED",
                    422,
                    "Request did not match the route schema.",
                );

                set.status = validation.status;

                return errorResponse(validation, requestId);
            }

            set.status = 500;

            registryServices.logger.error("Unhandled registry error", {
                requestId,
                error:
                    config.logLevel === "debug"
                        ? error
                        : error instanceof Error
                          ? { name: error.name, message: error.message }
                          : "UnknownError",
            });

            return errorResponse(
                new RegistryHttpError(
                    "INTERNAL_ERROR",
                    500,
                    "The registry could not complete the request.",
                ),
                requestId,
            );
        })
        .get(
            "/health",
            healthRoute(registryServices),
            healthOptions("health", "Check process and database health"),
        )
        .get(
            "/ready",
            readyRoute(registryServices),
            healthOptions("ready", "Check deployment readiness"),
        )
        .use(authRoutes(registryServices))
        .use(webauthnRoutes(registryServices))
        .use(organizationRoutes(registryServices))
        .use(packageRoutes(registryServices))
        .use(packageManagementRoutes(registryServices))
        .use(webhookRoutes(registryServices))
        .use(moderationRoutes(registryServices));
}
