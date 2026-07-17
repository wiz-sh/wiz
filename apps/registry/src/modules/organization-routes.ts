import { Elysia, t } from "elysia";
import { RegistryHttpError } from "../middleware/errors.ts";
import type { AuthPrincipal } from "../services/auth-service.ts";
import type { RegistryServices } from "../services/container.ts";

const roles = t.Union([
    t.Literal("owner"),
    t.Literal("admin"),
    t.Literal("maintainer"),
    t.Literal("member"),
    t.Literal("billing"),
    t.Literal("viewer"),
]);

const packagePermission = t.Union([
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

export function organizationRoutes(services: RegistryServices) {
    return new Elysia({ name: "registry-organization-routes" })
        .post(
            "/v1/orgs",
            async ({ request, body, set }) => {
                const principal = await services.auth.authenticate(request);

                const organization = await services.organizations.create(
                    principal,
                    body,
                );

                set.status = 201;

                return organization;
            },
            {
                body: t.Object({
                    name: t.String({ minLength: 3, maxLength: 64 }),
                    displayName: t.String({ minLength: 1, maxLength: 100 }),
                    private: t.Optional(t.Boolean()),
                }),
                ...options(
                    "createOrganization",
                    "Create an organization",
                    "Organizations",
                ),
            },
        )
        .get(
            "/v1/orgs",
            async ({ request }) => {
                const principal = await services.auth.authenticate(request);

                return {
                    items: await services.organizations.listForUser(
                        principal.userId,
                    ),
                };
            },
            options(
                "listOrganizations",
                "List the current user's organizations",
                "Organizations",
            ),
        )
        .get(
            "/v1/orgs/:org",
            async ({ request, params }) => {
                return services.organizations.get(
                    await optionalPrincipal(services, request),
                    params.org,
                );
            },
            {
                params: t.Object({ org: t.String() }),
                ...options(
                    "getOrganization",
                    "Get an organization",
                    "Organizations",
                ),
            },
        )
        .patch(
            "/v1/orgs/:org",
            async ({ request, params, body }) => {
                const principal = await services.auth.authenticate(request);

                return services.organizations.update(
                    principal,
                    params.org,
                    body,
                );
            },
            {
                params: t.Object({ org: t.String() }),
                body: t.Object({
                    displayName: t.Optional(
                        t.String({ minLength: 1, maxLength: 100 }),
                    ),
                    private: t.Optional(t.Boolean()),
                }),
                ...options(
                    "updateOrganization",
                    "Update an organization",
                    "Organizations",
                ),
            },
        )
        .delete(
            "/v1/orgs/:org",
            async ({ request, params, set }) => {
                const principal = await services.auth.authenticate(request);

                await services.organizations.remove(principal, params.org);

                set.status = 204;
            },
            {
                params: t.Object({ org: t.String() }),
                ...options(
                    "deleteOrganization",
                    "Delete an organization",
                    "Organizations",
                ),
            },
        )
        .get(
            "/v1/orgs/:org/members",
            async ({ request, params }) => {
                const principal = await services.auth.authenticate(request);

                return {
                    items: await services.organizations.members(
                        principal,
                        params.org,
                    ),
                };
            },
            {
                params: t.Object({ org: t.String() }),
                ...options(
                    "listOrganizationMembers",
                    "List organization members",
                    "Organization Members",
                ),
            },
        )
        .patch(
            "/v1/orgs/:org/members/:username",
            async ({ request, params, body }) => {
                const principal = await services.auth.authenticate(request);

                await services.organizations.updateMember(
                    principal,
                    params.org,
                    params.username,
                    body.role,
                );

                return { updated: true };
            },
            {
                params: t.Object({ org: t.String(), username: t.String() }),
                body: t.Object({ role: roles }),
                ...options(
                    "updateOrganizationMember",
                    "Update an organization member",
                    "Organization Members",
                ),
            },
        )
        .get(
            "/v1/orgs/:org/members/:username",
            async ({ request, params }) => {
                const principal = await services.auth.authenticate(request);

                return services.organizations.member(
                    principal,
                    params.org,
                    params.username,
                );
            },
            {
                params: t.Object({ org: t.String(), username: t.String() }),
                ...options(
                    "getOrganizationMember",
                    "Get an organization member",
                    "Organization Members",
                ),
            },
        )
        .delete(
            "/v1/orgs/:org/members/:username",
            async ({ request, params, set }) => {
                const principal = await services.auth.authenticate(request);

                await services.organizations.removeMember(
                    principal,
                    params.org,
                    params.username,
                );

                set.status = 204;
            },
            {
                params: t.Object({ org: t.String(), username: t.String() }),
                ...options(
                    "removeOrganizationMember",
                    "Remove an organization member",
                    "Organization Members",
                ),
            },
        )
        .post(
            "/v1/orgs/:org/invitations",
            async ({ request, params, body, set }) => {
                const principal = await services.auth.authenticate(request);

                const invitation = await services.organizations.invite(
                    principal,
                    params.org,
                    body,
                );

                set.status = 201;

                return invitation;
            },
            {
                params: t.Object({ org: t.String() }),
                body: t.Object({
                    username: t.Optional(t.String()),
                    email: t.Optional(t.String({ format: "email" })),
                    role: roles,
                }),
                ...options(
                    "createOrganizationInvitation",
                    "Invite an organization member",
                    "Organization Members",
                ),
            },
        )
        .get(
            "/v1/orgs/:org/invitations",
            async ({ request, params }) => {
                const principal = await services.auth.authenticate(request);

                return {
                    items: await services.organizations.invitations(
                        principal,
                        params.org,
                    ),
                };
            },
            {
                params: t.Object({ org: t.String() }),
                ...options(
                    "listOrganizationInvitations",
                    "List organization invitations",
                    "Organization Members",
                ),
            },
        )
        .delete(
            "/v1/orgs/:org/invitations/:invitationId",
            async ({ request, params, set }) => {
                const principal = await services.auth.authenticate(request);

                await services.organizations.removeInvitation(
                    principal,
                    params.org,
                    params.invitationId,
                );

                set.status = 204;
            },
            {
                params: t.Object({
                    org: t.String(),
                    invitationId: t.String({ format: "uuid" }),
                }),
                ...options(
                    "deleteOrganizationInvitation",
                    "Delete an organization invitation",
                    "Organization Members",
                ),
            },
        )
        .get(
            "/v1/users/me/invitations",
            async ({ request }) => {
                const principal = await services.auth.authenticate(request);

                return {
                    items: await services.organizations.invitationsForUser(
                        principal.userId,
                    ),
                };
            },
            options(
                "listCurrentUserInvitations",
                "List current user invitations",
                "Organization Members",
            ),
        )
        .post(
            "/v1/users/me/invitations/:invitationId/accept",
            async ({ request, params }) => {
                const principal = await services.auth.authenticate(request);

                await services.organizations.acceptInvitation(
                    principal,
                    params.invitationId,
                );

                return { accepted: true };
            },
            {
                params: t.Object({
                    invitationId: t.String({ format: "uuid" }),
                }),
                ...options(
                    "acceptOrganizationInvitation",
                    "Accept an organization invitation",
                    "Organization Members",
                ),
            },
        )
        .post(
            "/v1/users/me/invitations/:invitationId/decline",
            async ({ request, params }) => {
                const principal = await services.auth.authenticate(request);

                await services.organizations.declineInvitation(
                    principal,
                    params.invitationId,
                );

                return { declined: true };
            },
            {
                params: t.Object({
                    invitationId: t.String({ format: "uuid" }),
                }),
                ...options(
                    "declineOrganizationInvitation",
                    "Decline an organization invitation",
                    "Organization Members",
                ),
            },
        )
        .get(
            "/v1/orgs/:org/teams",
            async ({ request, params }) => {
                const principal = await services.auth.authenticate(request);

                return {
                    items: await services.organizations.teams(
                        principal,
                        params.org,
                    ),
                };
            },
            {
                params: t.Object({ org: t.String() }),
                ...options(
                    "listOrganizationTeams",
                    "List organization teams",
                    "Organization Teams",
                ),
            },
        )
        .post(
            "/v1/orgs/:org/teams",
            async ({ request, params, body, set }) => {
                const principal = await services.auth.authenticate(request);

                const team = await services.organizations.createTeam(
                    principal,
                    params.org,
                    body,
                );

                set.status = 201;

                return team;
            },
            {
                params: t.Object({ org: t.String() }),
                body: t.Object({
                    name: t.String({ minLength: 1, maxLength: 64 }),
                    description: t.Optional(t.String({ maxLength: 500 })),
                }),
                ...options(
                    "createOrganizationTeam",
                    "Create an organization team",
                    "Organization Teams",
                ),
            },
        )
        .get(
            "/v1/orgs/:org/teams/:team",
            async ({ request, params }) => {
                const principal = await services.auth.authenticate(request);

                return services.organizations.team(
                    principal,
                    params.org,
                    params.team,
                );
            },
            {
                params: t.Object({ org: t.String(), team: t.String() }),
                ...options(
                    "getOrganizationTeam",
                    "Get an organization team",
                    "Organization Teams",
                ),
            },
        )
        .patch(
            "/v1/orgs/:org/teams/:team",
            async ({ request, params, body }) => {
                const principal = await services.auth.authenticate(request);

                return services.organizations.updateTeam(
                    principal,
                    params.org,
                    params.team,
                    body,
                );
            },
            {
                params: t.Object({ org: t.String(), team: t.String() }),
                body: t.Object({
                    name: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
                    description: t.Optional(
                        t.Union([t.String({ maxLength: 500 }), t.Null()]),
                    ),
                }),
                ...options(
                    "updateOrganizationTeam",
                    "Update an organization team",
                    "Organization Teams",
                ),
            },
        )
        .delete(
            "/v1/orgs/:org/teams/:team",
            async ({ request, params, set }) => {
                const principal = await services.auth.authenticate(request);

                await services.organizations.removeTeam(
                    principal,
                    params.org,
                    params.team,
                );

                set.status = 204;
            },
            {
                params: t.Object({ org: t.String(), team: t.String() }),
                ...options(
                    "deleteOrganizationTeam",
                    "Delete an organization team",
                    "Organization Teams",
                ),
            },
        )
        .put(
            "/v1/orgs/:org/teams/:team/members/:username",
            async ({ request, params }) => {
                const principal = await services.auth.authenticate(request);

                await services.organizations.addTeamMember(
                    principal,
                    params.org,
                    params.team,
                    params.username,
                );

                return { added: true };
            },
            {
                params: t.Object({
                    org: t.String(),
                    team: t.String(),
                    username: t.String(),
                }),
                ...options(
                    "addOrganizationTeamMember",
                    "Add a member to a team",
                    "Organization Teams",
                ),
            },
        )
        .get(
            "/v1/orgs/:org/teams/:team/members",
            async ({ request, params }) => {
                const principal = await services.auth.authenticate(request);

                return {
                    items: await services.organizations.teamMembers(
                        principal,
                        params.org,
                        params.team,
                    ),
                };
            },
            {
                params: t.Object({ org: t.String(), team: t.String() }),
                ...options(
                    "listOrganizationTeamMembers",
                    "List team members",
                    "Organization Teams",
                ),
            },
        )
        .delete(
            "/v1/orgs/:org/teams/:team/members/:username",
            async ({ request, params, set }) => {
                const principal = await services.auth.authenticate(request);

                await services.organizations.removeTeamMember(
                    principal,
                    params.org,
                    params.team,
                    params.username,
                );

                set.status = 204;
            },
            {
                params: t.Object({
                    org: t.String(),
                    team: t.String(),
                    username: t.String(),
                }),
                ...options(
                    "removeOrganizationTeamMember",
                    "Remove a team member",
                    "Organization Teams",
                ),
            },
        )
        .get(
            "/v1/orgs/:org/teams/:team/packages",
            async ({ request, params }) => {
                const principal = await services.auth.authenticate(request);

                return {
                    items: await services.organizations.teamPackages(
                        principal,
                        params.org,
                        params.team,
                    ),
                };
            },
            {
                params: t.Object({ org: t.String(), team: t.String() }),
                ...options(
                    "listOrganizationTeamPackages",
                    "List team package grants",
                    "Organization Teams",
                ),
            },
        )
        .put(
            "/v1/orgs/:org/teams/:team/packages/:package",
            async ({ request, params, body }) => {
                const principal = await services.auth.authenticate(request);

                return services.organizations.setTeamPackage(
                    principal,
                    params.org,
                    params.team,
                    params.package,
                    body.permission,
                );
            },
            {
                params: t.Object({
                    org: t.String(),
                    team: t.String(),
                    package: t.String(),
                }),
                body: t.Object({ permission: packagePermission }),
                ...options(
                    "setOrganizationTeamPackage",
                    "Set a team package grant",
                    "Organization Teams",
                ),
            },
        )
        .patch(
            "/v1/orgs/:org/teams/:team/packages/:package",
            async ({ request, params, body }) => {
                const principal = await services.auth.authenticate(request);

                return services.organizations.setTeamPackage(
                    principal,
                    params.org,
                    params.team,
                    params.package,
                    body.permission,
                );
            },
            {
                params: t.Object({
                    org: t.String(),
                    team: t.String(),
                    package: t.String(),
                }),
                body: t.Object({ permission: packagePermission }),
                ...options(
                    "updateOrganizationTeamPackage",
                    "Update a team package grant",
                    "Organization Teams",
                ),
            },
        )
        .delete(
            "/v1/orgs/:org/teams/:team/packages/:package",
            async ({ request, params, set }) => {
                const principal = await services.auth.authenticate(request);

                await services.organizations.removeTeamPackage(
                    principal,
                    params.org,
                    params.team,
                    params.package,
                );

                set.status = 204;
            },
            {
                params: t.Object({
                    org: t.String(),
                    team: t.String(),
                    package: t.String(),
                }),
                ...options(
                    "removeOrganizationTeamPackage",
                    "Remove a team package grant",
                    "Organization Teams",
                ),
            },
        )
        .get(
            "/v1/orgs/:org/policies",
            async ({ request, params }) => {
                const principal = await services.auth.authenticate(request);

                return services.organizations.policy(principal, params.org);
            },
            {
                params: t.Object({ org: t.String() }),
                ...options(
                    "getOrganizationPolicies",
                    "Get organization policies",
                    "Organization Policies",
                ),
            },
        )
        .patch(
            "/v1/orgs/:org/policies",
            async ({ request, params, body }) => {
                const principal = await services.auth.authenticate(request);

                return services.organizations.updatePolicy(
                    principal,
                    params.org,
                    body,
                );
            },
            {
                params: t.Object({ org: t.String() }),
                body: t.Object({
                    requireMfaForPublish: t.Optional(t.Boolean()),
                    defaultPackageVisibility: t.Optional(
                        t.Union([t.Literal("public"), t.Literal("private")]),
                    ),
                    maximumTokenLifetimeDays: t.Optional(
                        t.Union([
                            t.Integer({ minimum: 1, maximum: 3650 }),
                            t.Null(),
                        ]),
                    ),
                }),
                ...options(
                    "updateOrganizationPolicies",
                    "Update organization policies",
                    "Organization Policies",
                ),
            },
        )
        .get(
            "/v1/orgs/:org/audit-log",
            async ({ request, params }) => {
                const principal = await services.auth.authenticate(request);

                return {
                    items: await services.organizations.auditLog(
                        principal,
                        params.org,
                    ),
                };
            },
            {
                params: t.Object({ org: t.String() }),
                ...options(
                    "getOrganizationAuditLog",
                    "Read the append-only organization audit log",
                    "Audit Logs",
                ),
            },
        );
}
