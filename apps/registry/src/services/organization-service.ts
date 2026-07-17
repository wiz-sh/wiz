import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { RegistryServerConfig } from "../config/types.ts";
import type { RegistryDatabase } from "../database/client.ts";
import {
    auditEvents,
    organizationInvitations,
    organizationMembers,
    organizationPolicies,
    organizations,
    organizationTeamMembers,
    organizationTeamPackages,
    organizationTeams,
    packages,
    userEmails,
    users,
} from "../database/schema.ts";
import { RegistryHttpError } from "../middleware/errors.ts";
import { requireTokenScope } from "../security/authorization.ts";
import { hashSecret, randomSecret } from "../security/crypto.ts";
import { normalizeIdentity } from "../security/names.ts";
import type { AuthPrincipal } from "./auth-service.ts";

const organizationPattern = /^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/;

const elevatedRoles = new Set(["owner", "admin"]);

export class OrganizationService {
    readonly #database: RegistryDatabase;

    readonly #config: RegistryServerConfig;

    constructor(database: RegistryDatabase, config: RegistryServerConfig) {
        this.#database = database;
        this.#config = config;
    }

    async create(
        principal: AuthPrincipal,
        input: { name: string; displayName: string; private?: boolean },
    ) {
        requireTokenScope(principal.scopes, "orgs:write");

        const name = normalizeIdentity(input.name);

        if (!organizationPattern.test(name)) {
            throw new RegistryHttpError(
                "VALIDATION_FAILED",
                400,
                "Organization name is invalid.",
            );
        }

        try {
            return await this.#database.transaction(async (transaction) => {
                const [created] = await transaction
                    .insert(organizations)
                    .values({
                        name,
                        nameNormalized: name,
                        displayName: input.displayName,
                        private: input.private ?? false,
                    })
                    .returning();

                if (created === undefined) {
                    throw new Error("Organization insert did not return a row");
                }

                await transaction.insert(organizationMembers).values({
                    organizationId: created.id,
                    userId: principal.userId,
                    role: "owner",
                });

                await transaction.insert(organizationPolicies).values({
                    organizationId: created.id,
                });

                await transaction.insert(auditEvents).values({
                    actorUserId: principal.userId,
                    actorTokenId: principal.tokenId,
                    organizationId: created.id,
                    action: "organization.created",
                });

                return {
                    id: created.id,
                    name: created.name,
                    displayName: created.displayName,
                    private: created.private,
                    role: "owner",
                };
            });
        } catch (err) {
            if (String(err).includes("unique")) {
                throw new RegistryHttpError(
                    "SCOPE_UNAVAILABLE",
                    409,
                    "Organization scope is unavailable.",
                );
            }

            throw err;
        }
    }

    async get(principal: AuthPrincipal | undefined, nameInput: string) {
        const organization = await this.find(nameInput);

        const membership =
            principal === undefined
                ? undefined
                : await this.membership(organization.id, principal.userId);

        if (organization.private && membership === undefined) {
            throw new RegistryHttpError(
                "ORG_NOT_FOUND",
                404,
                "Organization was not found.",
            );
        }

        return {
            id: organization.id,
            name: organization.name,
            displayName: organization.displayName,
            private: organization.private,
            ...(membership === undefined ? {} : { role: membership.role }),
        };
    }

    async update(
        principal: AuthPrincipal,
        nameInput: string,
        input: { displayName?: string; private?: boolean },
    ) {
        const organization = await this.find(nameInput);

        await this.requireAdmin(organization.id, principal.userId);

        const [updated] = await this.#database
            .update(organizations)
            .set(input)
            .where(eq(organizations.id, organization.id))
            .returning();

        await this.audit(
            principal,
            organization.id,
            "organization.updated",
            {},
        );

        return updated;
    }

    async remove(principal: AuthPrincipal, nameInput: string): Promise<void> {
        const organization = await this.find(nameInput);

        const membership = await this.requireMember(
            organization.id,
            principal.userId,
        );

        if (membership.role !== "owner") {
            throw new RegistryHttpError(
                "INSUFFICIENT_PERMISSION",
                403,
                "Organization owner permission is required.",
            );
        }

        await this.#database
            .update(organizations)
            .set({ deletedAt: new Date() })
            .where(eq(organizations.id, organization.id));
    }

    async listForUser(userId: string) {
        const records = await this.#database
            .select({
                organization: organizations,
                role: organizationMembers.role,
            })
            .from(organizationMembers)
            .innerJoin(
                organizations,
                eq(organizations.id, organizationMembers.organizationId),
            )
            .where(
                and(
                    eq(organizationMembers.userId, userId),
                    isNull(organizations.deletedAt),
                ),
            )
            .orderBy(organizations.name);

        return records.map(({ organization, role }) => {
            return {
                id: organization.id,
                name: organization.name,
                displayName: organization.displayName,
                private: organization.private,
                role,
            };
        });
    }

    async members(principal: AuthPrincipal, nameInput: string) {
        const organization = await this.find(nameInput);

        await this.requireMember(organization.id, principal.userId);

        return this.#database
            .select({
                username: users.username,
                displayName: users.displayName,
                role: organizationMembers.role,
                createdAt: organizationMembers.createdAt,
            })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(eq(organizationMembers.organizationId, organization.id))
            .orderBy(users.username);
    }

    async member(
        principal: AuthPrincipal,
        nameInput: string,
        usernameInput: string,
    ) {
        const organization = await this.find(nameInput);

        await this.requireMember(organization.id, principal.userId);

        const user = await this.findUser(usernameInput);

        const membership = await this.requireMember(organization.id, user.id);

        return {
            username: user.username,
            displayName: user.displayName,
            role: membership.role,
            createdAt: membership.createdAt,
        };
    }

    async updateMember(
        principal: AuthPrincipal,
        nameInput: string,
        usernameInput: string,
        role: string,
    ): Promise<void> {
        const organization = await this.find(nameInput);

        await this.requireAdmin(organization.id, principal.userId);

        const user = await this.findUser(usernameInput);

        await this.#database
            .update(organizationMembers)
            .set({ role })
            .where(
                and(
                    eq(organizationMembers.organizationId, organization.id),
                    eq(organizationMembers.userId, user.id),
                ),
            );

        await this.audit(
            principal,
            organization.id,
            "organization.member_updated",
            {
                username: user.username,
                role,
            },
        );
    }

    async removeMember(
        principal: AuthPrincipal,
        nameInput: string,
        usernameInput: string,
    ): Promise<void> {
        const organization = await this.find(nameInput);

        await this.requireAdmin(organization.id, principal.userId);

        const user = await this.findUser(usernameInput);

        const membership = await this.requireMember(organization.id, user.id);

        if (membership.role === "owner") {
            const owners = await this.#database
                .select({ userId: organizationMembers.userId })
                .from(organizationMembers)
                .where(
                    and(
                        eq(organizationMembers.organizationId, organization.id),
                        eq(organizationMembers.role, "owner"),
                    ),
                );

            if (owners.length <= 1) {
                throw new RegistryHttpError(
                    "LAST_ORG_OWNER",
                    409,
                    "The final organization owner cannot be removed.",
                );
            }
        }

        await this.#database
            .delete(organizationMembers)
            .where(
                and(
                    eq(organizationMembers.organizationId, organization.id),
                    eq(organizationMembers.userId, user.id),
                ),
            );

        await this.audit(
            principal,
            organization.id,
            "organization.member_removed",
            {
                username: user.username,
            },
        );
    }

    async invite(
        principal: AuthPrincipal,
        nameInput: string,
        input: { username?: string; email?: string; role: string },
    ) {
        const organization = await this.find(nameInput);

        await this.requireAdmin(organization.id, principal.userId);

        const token = randomSecret();

        const [created] = await this.#database
            .insert(organizationInvitations)
            .values({
                organizationId: organization.id,
                inviterId: principal.userId,
                usernameNormalized:
                    input.username === undefined
                        ? undefined
                        : normalizeIdentity(input.username),
                emailNormalized:
                    input.email === undefined
                        ? undefined
                        : normalizeIdentity(input.email),
                role: input.role,
                tokenHash: await hashSecret(token, this.#config.tokenPepper),
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
            })
            .returning();

        if (created === undefined) {
            throw new Error("Invitation insert did not return a row");
        }

        await this.audit(
            principal,
            organization.id,
            "organization.invitation_created",
            {
                invitationId: created.id,
            },
        );

        return {
            id: created.id,
            role: created.role,
            expiresAt: created.expiresAt.toISOString(),
            token,
        };
    }

    async invitations(principal: AuthPrincipal, nameInput: string) {
        const organization = await this.find(nameInput);

        await this.requireAdmin(organization.id, principal.userId);

        return this.#database
            .select({
                id: organizationInvitations.id,
                username: organizationInvitations.usernameNormalized,
                email: organizationInvitations.emailNormalized,
                role: organizationInvitations.role,
                expiresAt: organizationInvitations.expiresAt,
                acceptedAt: organizationInvitations.acceptedAt,
                declinedAt: organizationInvitations.declinedAt,
            })
            .from(organizationInvitations)
            .where(eq(organizationInvitations.organizationId, organization.id));
    }

    async removeInvitation(
        principal: AuthPrincipal,
        nameInput: string,
        invitationId: string,
    ): Promise<void> {
        const organization = await this.find(nameInput);

        await this.requireAdmin(organization.id, principal.userId);

        await this.#database
            .delete(organizationInvitations)
            .where(
                and(
                    eq(organizationInvitations.id, invitationId),
                    eq(organizationInvitations.organizationId, organization.id),
                ),
            );
    }

    async invitationsForUser(userId: string) {
        const [identity] = await this.#database
            .select({
                username: users.usernameNormalized,
                email: userEmails.emailNormalized,
            })
            .from(users)
            .innerJoin(userEmails, eq(userEmails.userId, users.id))
            .where(and(eq(users.id, userId), eq(userEmails.isPrimary, true)))
            .limit(1);

        if (identity === undefined) {
            return [];
        }

        return this.#database
            .select({
                id: organizationInvitations.id,
                organization: organizations.name,
                role: organizationInvitations.role,
                expiresAt: organizationInvitations.expiresAt,
            })
            .from(organizationInvitations)
            .innerJoin(
                organizations,
                eq(organizations.id, organizationInvitations.organizationId),
            )
            .where(
                and(
                    isNull(organizationInvitations.acceptedAt),
                    isNull(organizationInvitations.declinedAt),
                    or(
                        eq(
                            organizationInvitations.usernameNormalized,
                            identity.username,
                        ),
                        eq(
                            organizationInvitations.emailNormalized,
                            identity.email,
                        ),
                    ),
                ),
            );
    }

    async acceptInvitation(
        principal: AuthPrincipal,
        invitationId: string,
    ): Promise<void> {
        const invitations = await this.invitationsForUser(principal.userId);

        const invitation = invitations.find((entry) => {
            return entry.id === invitationId;
        });

        if (invitation === undefined || invitation.expiresAt <= new Date()) {
            throw new RegistryHttpError(
                "ORG_INVITATION_EXPIRED",
                404,
                "Organization invitation is unavailable or expired.",
            );
        }

        const [record] = await this.#database
            .select()
            .from(organizationInvitations)
            .where(eq(organizationInvitations.id, invitationId))
            .limit(1);

        if (record === undefined) {
            throw new RegistryHttpError(
                "ORG_INVITATION_EXPIRED",
                404,
                "Invitation expired.",
            );
        }

        await this.#database.transaction(async (transaction) => {
            await transaction
                .insert(organizationMembers)
                .values({
                    organizationId: record.organizationId,
                    userId: principal.userId,
                    role: record.role,
                })
                .onConflictDoNothing();

            await transaction
                .update(organizationInvitations)
                .set({ acceptedAt: new Date() })
                .where(eq(organizationInvitations.id, invitationId));
        });
    }

    async declineInvitation(
        principal: AuthPrincipal,
        invitationId: string,
    ): Promise<void> {
        const invitations = await this.invitationsForUser(principal.userId);

        if (
            !invitations.some(({ id }) => {
                return id === invitationId;
            })
        ) {
            throw new RegistryHttpError(
                "ORG_INVITATION_EXPIRED",
                404,
                "Organization invitation is unavailable or expired.",
            );
        }

        await this.#database
            .update(organizationInvitations)
            .set({ declinedAt: new Date() })
            .where(eq(organizationInvitations.id, invitationId));
    }

    async createTeam(
        principal: AuthPrincipal,
        nameInput: string,
        input: { name: string; description?: string },
    ) {
        const organization = await this.find(nameInput);

        await this.requireAdmin(organization.id, principal.userId);

        const [created] = await this.#database
            .insert(organizationTeams)
            .values({
                organizationId: organization.id,
                name: input.name,
                nameNormalized: normalizeIdentity(input.name),
                ...(input.description === undefined
                    ? {}
                    : { description: input.description }),
            })
            .returning();

        return created;
    }

    async teams(principal: AuthPrincipal, nameInput: string) {
        const organization = await this.find(nameInput);

        await this.requireMember(organization.id, principal.userId);

        return this.#database
            .select()
            .from(organizationTeams)
            .where(eq(organizationTeams.organizationId, organization.id))
            .orderBy(organizationTeams.name);
    }

    async team(
        principal: AuthPrincipal,
        organizationName: string,
        teamName: string,
    ) {
        const organization = await this.find(organizationName);

        await this.requireMember(organization.id, principal.userId);

        return this.findTeam(organization.id, teamName);
    }

    async updateTeam(
        principal: AuthPrincipal,
        organizationName: string,
        teamName: string,
        input: { name?: string; description?: string | null },
    ) {
        const organization = await this.find(organizationName);

        await this.requireAdmin(organization.id, principal.userId);

        const team = await this.findTeam(organization.id, teamName);

        const name =
            input.name === undefined
                ? undefined
                : normalizeIdentity(input.name);

        const [updated] = await this.#database
            .update(organizationTeams)
            .set({
                ...(name === undefined ? {} : { name, nameNormalized: name }),
                ...(input.description === undefined
                    ? {}
                    : { description: input.description }),
            })
            .where(eq(organizationTeams.id, team.id))
            .returning();

        return updated;
    }

    async removeTeam(
        principal: AuthPrincipal,
        organizationName: string,
        teamName: string,
    ): Promise<void> {
        const organization = await this.find(organizationName);

        await this.requireAdmin(organization.id, principal.userId);

        const team = await this.findTeam(organization.id, teamName);

        await this.#database
            .delete(organizationTeams)
            .where(eq(organizationTeams.id, team.id));
    }

    async addTeamMember(
        principal: AuthPrincipal,
        organizationName: string,
        teamName: string,
        username: string,
    ): Promise<void> {
        const organization = await this.find(organizationName);

        await this.requireAdmin(organization.id, principal.userId);

        const team = await this.findTeam(organization.id, teamName);

        const user = await this.findUser(username);

        await this.requireMember(organization.id, user.id);

        await this.#database
            .insert(organizationTeamMembers)
            .values({ teamId: team.id, userId: user.id })
            .onConflictDoNothing();
    }

    async teamMembers(
        principal: AuthPrincipal,
        organizationName: string,
        teamName: string,
    ) {
        const organization = await this.find(organizationName);

        await this.requireMember(organization.id, principal.userId);

        const team = await this.findTeam(organization.id, teamName);

        return this.#database
            .select({
                username: users.username,
                displayName: users.displayName,
            })
            .from(organizationTeamMembers)
            .innerJoin(users, eq(users.id, organizationTeamMembers.userId))
            .where(eq(organizationTeamMembers.teamId, team.id));
    }

    async removeTeamMember(
        principal: AuthPrincipal,
        organizationName: string,
        teamName: string,
        username: string,
    ): Promise<void> {
        const organization = await this.find(organizationName);

        await this.requireAdmin(organization.id, principal.userId);

        const team = await this.findTeam(organization.id, teamName);

        const user = await this.findUser(username);

        await this.#database
            .delete(organizationTeamMembers)
            .where(
                and(
                    eq(organizationTeamMembers.teamId, team.id),
                    eq(organizationTeamMembers.userId, user.id),
                ),
            );
    }

    async teamPackages(
        principal: AuthPrincipal,
        organizationName: string,
        teamName: string,
    ) {
        const organization = await this.find(organizationName);

        await this.requireMember(organization.id, principal.userId);

        const team = await this.findTeam(organization.id, teamName);

        return this.#database
            .select({
                package: packages.name,
                permission: organizationTeamPackages.permission,
            })
            .from(organizationTeamPackages)
            .innerJoin(
                packages,
                eq(packages.id, organizationTeamPackages.packageId),
            )
            .where(eq(organizationTeamPackages.teamId, team.id));
    }

    async setTeamPackage(
        principal: AuthPrincipal,
        organizationName: string,
        teamName: string,
        packageName: string,
        permission: string,
    ) {
        const organization = await this.find(organizationName);

        await this.requireAdmin(organization.id, principal.userId);

        const team = await this.findTeam(organization.id, teamName);

        const [packageRecord] = await this.#database
            .select()
            .from(packages)
            .where(
                and(
                    eq(packages.nameNormalized, packageName.toLowerCase()),
                    eq(packages.ownerOrganizationId, organization.id),
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

        await this.#database
            .insert(organizationTeamPackages)
            .values({
                teamId: team.id,
                packageId: packageRecord.id,
                permission,
            })
            .onConflictDoUpdate({
                target: [
                    organizationTeamPackages.teamId,
                    organizationTeamPackages.packageId,
                ],
                set: { permission },
            });

        return { package: packageRecord.name, permission };
    }

    async removeTeamPackage(
        principal: AuthPrincipal,
        organizationName: string,
        teamName: string,
        packageName: string,
    ): Promise<void> {
        const organization = await this.find(organizationName);

        await this.requireAdmin(organization.id, principal.userId);

        const team = await this.findTeam(organization.id, teamName);

        const [packageRecord] = await this.#database
            .select({ id: packages.id })
            .from(packages)
            .where(eq(packages.nameNormalized, packageName.toLowerCase()))
            .limit(1);

        if (packageRecord !== undefined) {
            await this.#database
                .delete(organizationTeamPackages)
                .where(
                    and(
                        eq(organizationTeamPackages.teamId, team.id),
                        eq(
                            organizationTeamPackages.packageId,
                            packageRecord.id,
                        ),
                    ),
                );
        }
    }

    async policy(principal: AuthPrincipal, nameInput: string) {
        const organization = await this.find(nameInput);

        await this.requireMember(organization.id, principal.userId);

        const [policy] = await this.#database
            .select()
            .from(organizationPolicies)
            .where(eq(organizationPolicies.organizationId, organization.id))
            .limit(1);

        return policy;
    }

    async updatePolicy(
        principal: AuthPrincipal,
        nameInput: string,
        input: {
            requireMfaForPublish?: boolean;
            defaultPackageVisibility?: "public" | "private";
            maximumTokenLifetimeDays?: number | null;
        },
    ) {
        const organization = await this.find(nameInput);

        await this.requireAdmin(organization.id, principal.userId);

        const [updated] = await this.#database
            .update(organizationPolicies)
            .set({ ...input, updatedAt: new Date() })
            .where(eq(organizationPolicies.organizationId, organization.id))
            .returning();

        await this.audit(
            principal,
            organization.id,
            "organization.policy_updated",
            {},
        );

        return updated;
    }

    async auditLog(principal: AuthPrincipal, nameInput: string) {
        const organization = await this.find(nameInput);

        await this.requireAdmin(organization.id, principal.userId);

        return this.#database
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.organizationId, organization.id))
            .orderBy(desc(auditEvents.createdAt))
            .limit(100);
    }

    private async find(nameInput: string) {
        const [organization] = await this.#database
            .select()
            .from(organizations)
            .where(
                and(
                    eq(
                        organizations.nameNormalized,
                        normalizeIdentity(nameInput),
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

        return organization;
    }

    private async findUser(username: string) {
        const [user] = await this.#database
            .select()
            .from(users)
            .where(eq(users.usernameNormalized, normalizeIdentity(username)))
            .limit(1);

        if (user === undefined) {
            throw new RegistryHttpError(
                "RESOURCE_NOT_FOUND",
                404,
                "User was not found.",
            );
        }

        return user;
    }

    private async membership(organizationId: string, userId: string) {
        const [membership] = await this.#database
            .select()
            .from(organizationMembers)
            .where(
                and(
                    eq(organizationMembers.organizationId, organizationId),
                    eq(organizationMembers.userId, userId),
                ),
            )
            .limit(1);

        return membership;
    }

    private async requireMember(organizationId: string, userId: string) {
        const membership = await this.membership(organizationId, userId);

        if (membership === undefined) {
            throw new RegistryHttpError(
                "INSUFFICIENT_PERMISSION",
                403,
                "Organization membership is required.",
            );
        }

        return membership;
    }

    private async requireAdmin(organizationId: string, userId: string) {
        const membership = await this.requireMember(organizationId, userId);

        if (!elevatedRoles.has(membership.role)) {
            throw new RegistryHttpError(
                "INSUFFICIENT_PERMISSION",
                403,
                "Organization owner or administrator permission is required.",
            );
        }

        return membership;
    }

    private async findTeam(organizationId: string, teamName: string) {
        const [team] = await this.#database
            .select()
            .from(organizationTeams)
            .where(
                and(
                    eq(organizationTeams.organizationId, organizationId),
                    eq(
                        organizationTeams.nameNormalized,
                        normalizeIdentity(teamName),
                    ),
                ),
            )
            .limit(1);

        if (team === undefined) {
            throw new RegistryHttpError(
                "RESOURCE_NOT_FOUND",
                404,
                "Team was not found.",
            );
        }

        return team;
    }

    private async audit(
        principal: AuthPrincipal,
        organizationId: string,
        action: string,
        metadata: Record<string, unknown>,
    ): Promise<void> {
        await this.#database.insert(auditEvents).values({
            actorUserId: principal.userId,
            actorTokenId: principal.tokenId,
            organizationId,
            action,
            metadata,
        });
    }
}
