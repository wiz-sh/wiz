import { Elysia, t } from "elysia";
import type { RegistryServices } from "../services/container.ts";

const permission = t.Union([
    t.Literal("read"),
    t.Literal("triage"),
    t.Literal("publish"),
    t.Literal("manage"),
    t.Literal("admin"),
]);

function options(operationId: string, summary: string, tag: string) {
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

export function packageManagementRoutes(services: RegistryServices) {
    return new Elysia({ name: "registry-package-management-routes" })
        .patch(
            "/v1/packages/:packageName",
            async ({ request, params, body }) => {
                const principal = await services.auth.authenticate(request);

                return services.packageManagement.update(
                    principal,
                    params.packageName,
                    body,
                );
            },
            {
                params: t.Object({ packageName: t.String() }),
                body: t.Object({
                    description: t.Optional(
                        t.Union([t.String({ maxLength: 2_000 }), t.Null()]),
                    ),
                    visibility: t.Optional(
                        t.Union([t.Literal("public"), t.Literal("private")]),
                    ),
                }),
                ...options(
                    "updatePackage",
                    "Update package metadata",
                    "Packages",
                ),
            },
        )
        .delete(
            "/v1/packages/:packageName",
            async ({ request, params, body, set }) => {
                const principal = await services.auth.authenticate(request);

                await services.packageManagement.remove(
                    principal,
                    params.packageName,
                    body.reason,
                );

                set.status = 204;
            },
            {
                params: t.Object({ packageName: t.String() }),
                body: t.Object({
                    reason: t.Optional(t.String({ maxLength: 1_000 })),
                }),
                ...options("deletePackage", "Tombstone a package", "Packages"),
            },
        )
        .put(
            "/v1/packages/:packageName/dist-tags/:tag",
            async ({ request, params, body }) => {
                const principal = await services.auth.authenticate(request);

                return services.packageManagement.setTag(
                    principal,
                    params.packageName,
                    params.tag,
                    body.version,
                );
            },
            {
                params: t.Object({ packageName: t.String(), tag: t.String() }),
                body: t.Object({ version: t.String() }),
                ...options(
                    "setPackageDistTag",
                    "Set a distribution tag",
                    "Distribution Tags",
                ),
            },
        )
        .get(
            "/v1/packages/:packageName/dist-tags",
            ({ params }) => {
                return services.packageManagement.tags(params.packageName);
            },
            {
                params: t.Object({ packageName: t.String() }),
                ...options(
                    "getPackageDistTags",
                    "List distribution tags",
                    "Distribution Tags",
                ),
            },
        )
        .delete(
            "/v1/packages/:packageName/dist-tags/:tag",
            async ({ request, params, set }) => {
                const principal = await services.auth.authenticate(request);

                await services.packageManagement.removeTag(
                    principal,
                    params.packageName,
                    params.tag,
                );

                set.status = 204;
            },
            {
                params: t.Object({ packageName: t.String(), tag: t.String() }),
                ...options(
                    "removePackageDistTag",
                    "Remove a distribution tag",
                    "Distribution Tags",
                ),
            },
        )
        .post(
            "/v1/packages/:packageName/versions/:version/deprecate",
            async ({ request, params, body }) => {
                const principal = await services.auth.authenticate(request);

                return services.packageManagement.deprecate(
                    principal,
                    params.packageName,
                    params.version,
                    body.message,
                );
            },
            {
                params: t.Object({
                    packageName: t.String(),
                    version: t.String(),
                }),
                body: t.Object({
                    message: t.String({ minLength: 1, maxLength: 1_000 }),
                }),
                ...options(
                    "deprecatePackageVersion",
                    "Deprecate a package version",
                    "Package Versions",
                ),
            },
        )
        .delete(
            "/v1/packages/:packageName/versions/:version/deprecation",
            async ({ request, params, set }) => {
                const principal = await services.auth.authenticate(request);

                await services.packageManagement.removeDeprecation(
                    principal,
                    params.packageName,
                    params.version,
                );

                set.status = 204;
            },
            {
                params: t.Object({
                    packageName: t.String(),
                    version: t.String(),
                }),
                ...options(
                    "removePackageDeprecation",
                    "Remove a package deprecation",
                    "Package Versions",
                ),
            },
        )
        .put(
            "/v1/packages/:packageName/collaborators/:username",
            async ({ request, params, body }) => {
                const principal = await services.auth.authenticate(request);

                return services.packageManagement.collaborator(
                    principal,
                    params.packageName,
                    params.username,
                    body.permission,
                );
            },
            {
                params: t.Object({
                    packageName: t.String(),
                    username: t.String(),
                }),
                body: t.Object({ permission }),
                ...options(
                    "setPackageCollaborator",
                    "Set a package collaborator",
                    "Packages",
                ),
            },
        )
        .patch(
            "/v1/packages/:packageName/collaborators/:username",
            async ({ request, params, body }) => {
                const principal = await services.auth.authenticate(request);

                return services.packageManagement.collaborator(
                    principal,
                    params.packageName,
                    params.username,
                    body.permission,
                );
            },
            {
                params: t.Object({
                    packageName: t.String(),
                    username: t.String(),
                }),
                body: t.Object({ permission }),
                ...options(
                    "updatePackageCollaborator",
                    "Update a package collaborator",
                    "Packages",
                ),
            },
        )
        .get(
            "/v1/packages/:packageName/collaborators",
            async ({ request, params }) => {
                const principal = await services.auth.authenticate(request);

                return {
                    items: await services.packageManagement.collaborators(
                        principal,
                        params.packageName,
                    ),
                };
            },
            {
                params: t.Object({ packageName: t.String() }),
                ...options(
                    "listPackageCollaborators",
                    "List package collaborators",
                    "Packages",
                ),
            },
        )
        .delete(
            "/v1/packages/:packageName/collaborators/:username",
            async ({ request, params, set }) => {
                const principal = await services.auth.authenticate(request);

                await services.packageManagement.removeCollaborator(
                    principal,
                    params.packageName,
                    params.username,
                );

                set.status = 204;
            },
            {
                params: t.Object({
                    packageName: t.String(),
                    username: t.String(),
                }),
                ...options(
                    "removePackageCollaborator",
                    "Remove a package collaborator",
                    "Packages",
                ),
            },
        )
        .post(
            "/v1/packages/:packageName/access",
            async ({ request, params, body, set }) => {
                const principal = await services.auth.authenticate(request);

                const grant = await services.packageManagement.grant(
                    principal,
                    params.packageName,
                    body,
                );

                set.status = 201;

                return grant;
            },
            {
                params: t.Object({ packageName: t.String() }),
                body: t.Object({ username: t.String(), permission }),
                ...options(
                    "createPackageAccessGrant",
                    "Grant private package access",
                    "Packages",
                ),
            },
        )
        .delete(
            "/v1/packages/:packageName/access/:grantId",
            async ({ request, params, set }) => {
                const principal = await services.auth.authenticate(request);

                await services.packageManagement.removeGrant(
                    principal,
                    params.packageName,
                    params.grantId,
                );

                set.status = 204;
            },
            {
                params: t.Object({
                    packageName: t.String(),
                    grantId: t.String({ format: "uuid" }),
                }),
                ...options(
                    "removePackageAccessGrant",
                    "Remove private package access",
                    "Packages",
                ),
            },
        )
        .get(
            "/v1/packages/:packageName/access",
            async ({ request, params }) => {
                const principal = await services.auth.authenticate(request);

                return {
                    items: await services.packageManagement.grants(
                        principal,
                        params.packageName,
                    ),
                };
            },
            {
                params: t.Object({ packageName: t.String() }),
                ...options(
                    "listPackageAccess",
                    "List private package grants",
                    "Packages",
                ),
            },
        )
        .post(
            "/v1/packages/:packageName/transfer",
            async ({ request, params, body }) => {
                const principal = await services.auth.authenticate(request);

                return services.packageManagement.transfer(
                    principal,
                    params.packageName,
                    body,
                );
            },
            {
                params: t.Object({ packageName: t.String() }),
                body: t.Object({
                    username: t.Optional(t.String()),
                    organization: t.Optional(t.String()),
                }),
                ...options(
                    "transferPackage",
                    "Transfer package ownership",
                    "Packages",
                ),
            },
        )
        .get(
            "/v1/packages/:packageName/dependencies",
            ({ params, query }) => {
                return services.packageManagement.dependencies(
                    params.packageName,
                    query.version,
                );
            },
            {
                params: t.Object({ packageName: t.String() }),
                query: t.Object({ version: t.Optional(t.String()) }),
                ...options(
                    "getPackageDependencies",
                    "Get package dependencies",
                    "Packages",
                ),
            },
        )
        .get(
            "/v1/packages/:packageName/dependents",
            async ({ params }) => {
                return {
                    items: await services.packageManagement.dependents(
                        params.packageName,
                    ),
                };
            },
            {
                params: t.Object({ packageName: t.String() }),
                ...options(
                    "getPackageDependents",
                    "Get package dependents",
                    "Packages",
                ),
            },
        )
        .get(
            "/v1/packages/:packageName/downloads",
            ({ params }) => {
                return services.packageManagement.downloads(params.packageName);
            },
            {
                params: t.Object({ packageName: t.String() }),
                ...options(
                    "getPackageDownloads",
                    "Get package download statistics",
                    "Packages",
                ),
            },
        )
        .get(
            "/v1/packages/:packageName/analytics/downloads",
            ({ params }) => {
                return services.packageManagement.downloads(params.packageName);
            },
            {
                params: t.Object({ packageName: t.String() }),
                ...options(
                    "getPackageDownloadAnalytics",
                    "Get package download analytics",
                    "Packages",
                ),
            },
        );
}
