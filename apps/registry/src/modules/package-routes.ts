import { Elysia, t } from "elysia";
import { RegistryHttpError } from "../middleware/errors.ts";
import type { AuthPrincipal } from "../services/auth-service.ts";
import type { RegistryServices } from "../services/container.ts";

const bearerSecurity = [{ bearerAuth: [] }];

function operation(
    operationId: string,
    summary: string,
    tag: string,
    secured = false,
) {
    return {
        detail: {
            operationId,
            summary,
            description: summary,
            tags: [tag],
            ...(secured ? { security: bearerSecurity } : {}),
        },
    };
}

async function optionalPrincipal(
    services: RegistryServices,
    request: Request,
): Promise<AuthPrincipal | undefined> {
    try {
        return await services.auth.authenticate(request);
    } catch (err) {
        if (
            err instanceof RegistryHttpError &&
            err.code === "AUTHENTICATION_REQUIRED"
        ) {
            return undefined;
        }

        throw err;
    }
}

/** Package routes use encoded path parameters so scoped names never become path segments. */
export function packageRoutes(services: RegistryServices) {
    return new Elysia({ name: "registry-package-routes" })
        .post(
            "/v1/packages",
            async ({ request, body, set }) => {
                const principal = await services.auth.authenticate(request);

                const created = await services.packages.create(principal, body);

                set.status = 201;

                return created;
            },
            {
                body: t.Object({
                    name: t.String({ minLength: 1, maxLength: 130 }),
                    description: t.Optional(t.String({ maxLength: 2_000 })),
                    visibility: t.Union([
                        t.Literal("public"),
                        t.Literal("private"),
                    ]),
                }),
                ...operation(
                    "createPackage",
                    "Create a package",
                    "Packages",
                    true,
                ),
            },
        )
        .get(
            "/v1/packages/:packageName",
            async ({ request, params }) => {
                return services.packages.get(
                    params.packageName,
                    await optionalPrincipal(services, request),
                );
            },
            {
                params: t.Object({ packageName: t.String() }),
                ...operation("getPackage", "Get package metadata", "Packages"),
            },
        )
        .get(
            "/v1/packages/:packageName/versions",
            async ({ request, params }) => {
                return {
                    items: await services.packages.versions(
                        params.packageName,
                        await optionalPrincipal(services, request),
                    ),
                };
            },
            {
                params: t.Object({ packageName: t.String() }),
                ...operation(
                    "listPackageVersions",
                    "List package versions",
                    "Package Versions",
                ),
            },
        )
        .get(
            "/v1/packages/:packageName/versions/:version",
            async ({ request, params }) => {
                return services.packages.version(
                    params.packageName,
                    params.version,
                    await optionalPrincipal(services, request),
                );
            },
            {
                params: t.Object({
                    packageName: t.String(),
                    version: t.String(),
                }),
                ...operation(
                    "getPackageVersion",
                    "Get an immutable package version",
                    "Package Versions",
                ),
            },
        )
        .post(
            "/v1/packages/:packageName/publishes",
            async ({ request, params, body, set }) => {
                const principal = await services.auth.authenticate(request);

                const created = await services.packages.createPublish(
                    principal,
                    params.packageName,
                    body,
                );

                set.status = 201;

                return created;
            },
            {
                params: t.Object({ packageName: t.String() }),
                body: t.Object({
                    version: t.String({ minLength: 5, maxLength: 100 }),
                    integrity: t.String({ pattern: "^sha512-" }),
                    size: t.Integer({ minimum: 1, maximum: 26_214_400 }),
                }),
                ...operation(
                    "createPublish",
                    "Create a publish transaction",
                    "Publishing",
                    true,
                ),
            },
        )
        .put(
            "/v1/packages/:packageName/publishes/:publishId/archive",
            async ({ request, params, body, set }) => {
                const principal = await services.auth.authenticate(request);

                if (!(body instanceof ArrayBuffer)) {
                    throw new RegistryHttpError(
                        "VALIDATION_FAILED",
                        422,
                        "Archive uploads must contain binary data.",
                    );
                }

                const bytes = new Uint8Array(body);

                await services.packages.uploadPublish(
                    principal,
                    params.packageName,
                    params.publishId,
                    bytes,
                );

                set.status = 204;
            },
            {
                parse: "arrayBuffer",
                body: t.Unknown(),
                params: t.Object({
                    packageName: t.String(),
                    publishId: t.String({ format: "uuid" }),
                }),
                ...operation(
                    "uploadPublishArchive",
                    "Upload a package archive",
                    "Publishing",
                    true,
                ),
            },
        )
        .post(
            "/v1/packages/:packageName/publishes/:publishId/finalize",
            async ({ request, params }) => {
                const principal = await services.auth.authenticate(request);

                return services.packages.finalizePublish(
                    principal,
                    params.packageName,
                    params.publishId,
                );
            },
            {
                params: t.Object({
                    packageName: t.String(),
                    publishId: t.String({ format: "uuid" }),
                }),
                ...operation(
                    "finalizePublish",
                    "Finalize an immutable publication",
                    "Publishing",
                    true,
                ),
            },
        )
        .get(
            "/v1/packages/:packageName/publishes/:publishId",
            async ({ request, params }) => {
                const principal = await services.auth.authenticate(request);

                return services.packages.publishStatus(
                    principal,
                    params.packageName,
                    params.publishId,
                );
            },
            {
                params: t.Object({
                    packageName: t.String(),
                    publishId: t.String({ format: "uuid" }),
                }),
                ...operation(
                    "getPublish",
                    "Get publish transaction state",
                    "Publishing",
                    true,
                ),
            },
        )
        .get(
            "/v1/packages/:packageName/versions/:version/archive",
            async ({ request, params, set }) => {
                const archive = await services.packages.archive(
                    params.packageName,
                    params.version,
                    await optionalPrincipal(services, request),
                );

                set.headers["content-type"] = "application/gzip";
                set.headers["x-wiz-integrity"] = archive.integrity;
                set.headers["cache-control"] = archive.public
                    ? "public, max-age=31536000, immutable"
                    : "private, no-store";

                return archive.bytes;
            },
            {
                params: t.Object({
                    packageName: t.String(),
                    version: t.String(),
                }),
                ...operation(
                    "downloadPackageArchive",
                    "Download an immutable package archive",
                    "Downloads",
                ),
            },
        )
        .head(
            "/v1/packages/:packageName/versions/:version/archive",
            async ({ request, params, set }) => {
                const archive = await services.packages.archive(
                    params.packageName,
                    params.version,
                    await optionalPrincipal(services, request),
                );

                set.headers["content-length"] = String(
                    archive.bytes.byteLength,
                );
                set.headers["x-wiz-integrity"] = archive.integrity;

                return "";
            },
            {
                params: t.Object({
                    packageName: t.String(),
                    version: t.String(),
                }),
                ...operation(
                    "headPackageArchive",
                    "Inspect an immutable package archive",
                    "Downloads",
                ),
            },
        )
        .get(
            "/v1/search",
            async ({ request, query }) => {
                return services.packages.search(
                    {
                        query: query.q,
                        ...(query.cursor === undefined
                            ? {}
                            : { cursor: query.cursor }),
                        ...(query.scope === undefined
                            ? {}
                            : { scope: query.scope }),
                        ...(query.owner === undefined
                            ? {}
                            : { owner: query.owner }),
                        ...(query.keyword === undefined
                            ? {}
                            : { keyword: query.keyword }),
                        ...(query.visibility === undefined
                            ? {}
                            : { visibility: query.visibility }),
                        ...(query.sort === undefined
                            ? {}
                            : { sort: query.sort }),
                        ...(query.limit === undefined
                            ? {}
                            : { limit: query.limit }),
                    },
                    await optionalPrincipal(services, request),
                );
            },
            {
                query: t.Object({
                    q: t.String({ minLength: 1, maxLength: 200 }),
                    cursor: t.Optional(t.String()),
                    scope: t.Optional(
                        t.String({ pattern: "^@[a-z0-9][a-z0-9-]{0,38}$" }),
                    ),
                    owner: t.Optional(
                        t.String({ minLength: 1, maxLength: 40 }),
                    ),
                    keyword: t.Optional(
                        t.String({ minLength: 1, maxLength: 100 }),
                    ),
                    visibility: t.Optional(
                        t.Union([t.Literal("public"), t.Literal("private")]),
                    ),
                    sort: t.Optional(
                        t.Union([
                            t.Literal("relevance"),
                            t.Literal("name"),
                            t.Literal("name-desc"),
                            t.Literal("recent"),
                        ]),
                    ),
                    limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
                }),
                ...operation(
                    "searchPackages",
                    "Search visible packages",
                    "Search",
                ),
            },
        );
}
