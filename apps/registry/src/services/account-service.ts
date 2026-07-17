import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { RegistryServerConfig } from "../config/types.ts";
import type { RegistryDatabase } from "../database/client.ts";
import {
    accessTokens,
    authChallenges,
    sessions,
    tokenScopes,
    users,
} from "../database/schema.ts";
import { RegistryHttpError } from "../middleware/errors.ts";
import { hashSecret, randomSecret } from "../security/crypto.ts";
import { normalizeIdentity } from "../security/names.ts";
import type { AuthPrincipal, AuthService } from "./auth-service.ts";

const profilePattern = /^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/;

/** Owns mutable account metadata and revocable login state outside credentials. */
export class AccountService {
    readonly #database: RegistryDatabase;

    readonly #config: RegistryServerConfig;

    readonly #auth: AuthService;

    constructor(
        database: RegistryDatabase,
        config: RegistryServerConfig,
        auth: AuthService,
    ) {
        this.#database = database;
        this.#config = config;
        this.#auth = auth;
    }

    async updateProfile(
        principal: AuthPrincipal,
        input: { username?: string; displayName?: string | null },
    ) {
        const username =
            input.username === undefined
                ? undefined
                : normalizeIdentity(input.username);

        if (username !== undefined && !profilePattern.test(username)) {
            throw new RegistryHttpError(
                "VALIDATION_FAILED",
                422,
                "Username is invalid.",
            );
        }

        try {
            await this.#database
                .update(users)
                .set({
                    ...(username === undefined
                        ? {}
                        : { username, usernameNormalized: username }),
                    ...(input.displayName === undefined
                        ? {}
                        : { displayName: input.displayName }),
                    updatedAt: new Date(),
                })
                .where(eq(users.id, principal.userId));
        } catch (err) {
            if (String(err).includes("unique")) {
                throw new RegistryHttpError(
                    "USERNAME_UNAVAILABLE",
                    409,
                    "Username is unavailable.",
                );
            }

            throw err;
        }

        return this.#auth.user(principal.userId);
    }

    async publicUser(usernameInput: string) {
        const [user] = await this.#database
            .select({
                id: users.id,
                username: users.username,
                displayName: users.displayName,
                createdAt: users.createdAt,
            })
            .from(users)
            .where(
                and(
                    eq(
                        users.usernameNormalized,
                        normalizeIdentity(usernameInput),
                    ),
                    isNull(users.disabledAt),
                ),
            )
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

    async logout(principal: AuthPrincipal): Promise<void> {
        if (principal.tokenId !== undefined) {
            await this.#database
                .update(accessTokens)
                .set({ revokedAt: new Date() })
                .where(eq(accessTokens.id, principal.tokenId));
        }

        if (principal.sessionId !== undefined) {
            await this.#database
                .update(sessions)
                .set({ revokedAt: new Date() })
                .where(eq(sessions.id, principal.sessionId));
        }
    }

    async logoutAll(userId: string): Promise<void> {
        const now = new Date();

        await this.#database
            .update(accessTokens)
            .set({ revokedAt: now })
            .where(eq(accessTokens.userId, userId));

        await this.#database
            .update(sessions)
            .set({ revokedAt: now })
            .where(eq(sessions.userId, userId));
    }

    async listSessions(userId: string) {
        return this.#database
            .select({
                id: sessions.id,
                userAgent: sessions.userAgent,
                ipAddress: sessions.ipAddress,
                createdAt: sessions.createdAt,
                expiresAt: sessions.expiresAt,
                revokedAt: sessions.revokedAt,
            })
            .from(sessions)
            .where(eq(sessions.userId, userId))
            .orderBy(desc(sessions.createdAt));
    }

    async revokeSession(userId: string, sessionId: string): Promise<void> {
        await this.#database
            .update(sessions)
            .set({ revokedAt: new Date() })
            .where(
                and(eq(sessions.id, sessionId), eq(sessions.userId, userId)),
            );
    }

    async token(userId: string, tokenId: string) {
        const [record] = await this.#database
            .select()
            .from(accessTokens)
            .where(
                and(
                    eq(accessTokens.id, tokenId),
                    eq(accessTokens.userId, userId),
                ),
            )
            .limit(1);

        if (record === undefined) {
            throw new RegistryHttpError(
                "RESOURCE_NOT_FOUND",
                404,
                "Access token was not found.",
            );
        }

        const scopes = await this.#database
            .select({ scope: tokenScopes.scope })
            .from(tokenScopes)
            .where(eq(tokenScopes.tokenId, tokenId));

        return {
            id: record.id,
            name: record.name,
            prefix: record.tokenPrefix,
            type: record.tokenType,
            scopes: scopes.map(({ scope }) => {
                return scope;
            }),
            packages: record.packageRestrictions,
            expiresAt: record.expiresAt,
            revokedAt: record.revokedAt,
            lastUsedAt: record.lastUsedAt,
            createdAt: record.createdAt,
        };
    }

    async renameToken(userId: string, tokenId: string, name: string) {
        const [updated] = await this.#database
            .update(accessTokens)
            .set({ name })
            .where(
                and(
                    eq(accessTokens.id, tokenId),
                    eq(accessTokens.userId, userId),
                ),
            )
            .returning({ id: accessTokens.id });

        if (updated === undefined) {
            throw new RegistryHttpError(
                "RESOURCE_NOT_FOUND",
                404,
                "Access token was not found.",
            );
        }

        return this.token(userId, tokenId);
    }

    async beginDeviceAuthorization() {
        const deviceSecret = randomSecret();

        const userCode = crypto
            .randomUUID()
            .replaceAll("-", "")
            .slice(0, 8)
            .toUpperCase();

        const expiresAt = new Date(Date.now() + 10 * 60 * 1_000);

        const [challenge] = await this.#database
            .insert(authChallenges)
            .values({
                kind: "device_authorization",
                challengeHash: await hashSecret(
                    deviceSecret,
                    this.#config.tokenPepper,
                ),
                payload: {
                    userCodeHash: await hashSecret(
                        userCode,
                        this.#config.tokenPepper,
                    ),
                    authorized: false,
                },
                expiresAt,
            })
            .returning();

        if (challenge === undefined) {
            throw new Error("Device challenge insert did not return a row");
        }

        return {
            deviceCode: `${challenge.id}.${deviceSecret}`,
            userCode,
            verificationUri: `${this.#config.publicUrl}/device`,
            expiresAt: expiresAt.toISOString(),
            interval: 2,
        };
    }

    async approveDevice(
        principal: AuthPrincipal,
        userCode: string,
    ): Promise<void> {
        const codeHash = await hashSecret(
            userCode.toUpperCase(),
            this.#config.tokenPepper,
        );

        const challenges = await this.#database
            .select()
            .from(authChallenges)
            .where(
                and(
                    eq(authChallenges.kind, "device_authorization"),
                    isNull(authChallenges.usedAt),
                    gt(authChallenges.expiresAt, new Date()),
                ),
            );

        const challenge = challenges.find((candidate) => {
            return candidate.payload.userCodeHash === codeHash;
        });

        if (challenge === undefined) {
            throw new RegistryHttpError(
                "AUTHENTICATION_FAILED",
                400,
                "Device code is invalid or expired.",
            );
        }

        await this.#database
            .update(authChallenges)
            .set({
                userId: principal.userId,
                payload: {
                    ...challenge.payload,
                    authorized: true,
                },
            })
            .where(eq(authChallenges.id, challenge.id));
    }

    async exchangeDeviceCode(deviceCode: string) {
        const [id, secret] = deviceCode.split(".", 2);

        if (id === undefined || secret === undefined) {
            throw new RegistryHttpError(
                "AUTHENTICATION_FAILED",
                400,
                "Device code is invalid.",
            );
        }

        const [challenge] = await this.#database
            .select()
            .from(authChallenges)
            .where(
                and(
                    eq(authChallenges.id, id),
                    eq(authChallenges.kind, "device_authorization"),
                    isNull(authChallenges.usedAt),
                    gt(authChallenges.expiresAt, new Date()),
                ),
            )
            .limit(1);

        if (
            challenge === undefined ||
            challenge.challengeHash !==
                (await hashSecret(secret, this.#config.tokenPepper))
        ) {
            throw new RegistryHttpError(
                "AUTHENTICATION_FAILED",
                400,
                "Device code is invalid or expired.",
            );
        }

        if (
            challenge.payload.authorized !== true ||
            challenge.userId === null
        ) {
            return { state: "authorization_pending" as const };
        }

        const created = await this.#auth.createAccessToken(challenge.userId, {
            name: "CLI device login",
            scopes: [
                "profile:read",
                "packages:read",
                "packages:write",
                "orgs:write",
            ],
            type: "personal",
        });

        await this.#database
            .update(authChallenges)
            .set({ usedAt: new Date() })
            .where(eq(authChallenges.id, challenge.id));

        return {
            state: "authenticated" as const,
            token: created.token,
        };
    }
}
