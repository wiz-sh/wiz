import { and, desc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import type { RegistryServerConfig } from "../config/types.ts";
import type { RegistryDatabase } from "../database/client.ts";
import {
    accessTokens,
    authChallenges,
    emailVerificationTokens,
    passwordCredentials,
    passwordResetTokens,
    recoveryCodes,
    sessions,
    tokenScopes,
    totpCredentials,
    userEmails,
    users,
} from "../database/schema.ts";
import type { RegistryMailer } from "../email/client.ts";
import { passwordResetEmail, verificationEmail } from "../email/templates.ts";
import {
    authenticationRequired,
    RegistryHttpError,
    validationFailed,
} from "../middleware/errors.ts";
import {
    decryptSecret,
    encryptSecret,
    hashPassword,
    hashSecret,
    randomSecret,
    verifyPassword,
} from "../security/crypto.ts";
import { normalizeIdentity } from "../security/names.ts";
import { createTotpSecret, verifyTotp } from "../security/totp.ts";

const usernamePattern = /^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const defaultScopes = [
    "profile:read",
    "packages:read",
    "packages:write",
    "orgs:write",
];

export interface AuthPrincipal {
    userId: string;
    tokenId?: string;
    sessionId?: string;
    scopes: readonly string[];
    packageRestrictions: readonly string[];
    recentAuthAt: Date;
}

export interface LoginResult {
    state: "authenticated" | "mfa_required";
    token?: string;
    challengeId?: string;
    expiresAt?: string;
}

export interface CreatedSession {
    cookie: string;
    csrfToken: string;
    expiresAt: string;
}

export interface AuthClock {
    now(): Date;
}

const systemClock: AuthClock = {
    now() {
        return new Date();
    },
};

function expiresFrom(now: Date, milliseconds: number): Date {
    return new Date(now.getTime() + milliseconds);
}

function publicUser(
    user: typeof users.$inferSelect,
    email: typeof userEmails.$inferSelect,
    mfaEnabled: boolean,
) {
    return {
        id: user.id,
        username: user.username,
        email: email.email,
        emailVerified: email.verifiedAt !== null,
        mfaEnabled,
    };
}

/** Owns credential hashing, session lifecycle, MFA state, and token scope checks. */
export class AuthService {
    readonly #database: RegistryDatabase;

    readonly #config: RegistryServerConfig;

    readonly #mailer: RegistryMailer;

    readonly #clock: AuthClock;

    constructor(
        database: RegistryDatabase,
        config: RegistryServerConfig,
        mailer: RegistryMailer,
        clock: AuthClock = systemClock,
    ) {
        this.#database = database;
        this.#config = config;
        this.#mailer = mailer;
        this.#clock = clock;
    }

    async signup(input: { username: string; email: string; password: string }) {
        const usernameNormalized = normalizeIdentity(input.username);

        const emailNormalized = normalizeIdentity(input.email);

        if (!usernamePattern.test(usernameNormalized)) {
            throw validationFailed(
                "Username must contain 3-64 lowercase letters, digits, dots, dashes, or underscores.",
            );
        }

        if (!emailPattern.test(emailNormalized)) {
            throw validationFailed("Email address is invalid.");
        }

        if (input.password.length < 12 || input.password.length > 512) {
            throw validationFailed(
                "Password must contain between 12 and 512 characters.",
            );
        }

        const passwordHash = await hashPassword(
            input.password,
            this.#config.passwordPepper,
        );

        const verificationToken = randomSecret();

        const verificationHash = await hashSecret(
            verificationToken,
            this.#config.tokenPepper,
        );

        const now = this.#clock.now();

        let createdUser: typeof users.$inferSelect | undefined;

        let createdEmail: typeof userEmails.$inferSelect | undefined;

        try {
            await this.#database.transaction(async (transaction) => {
                [createdUser] = await transaction
                    .insert(users)
                    .values({
                        username: usernameNormalized,
                        usernameNormalized,
                    })
                    .returning();

                if (createdUser === undefined) {
                    throw new Error("User insert did not return a row");
                }

                [createdEmail] = await transaction
                    .insert(userEmails)
                    .values({
                        userId: createdUser.id,
                        email: emailNormalized,
                        emailNormalized,
                        isPrimary: true,
                    })
                    .returning();

                await transaction.insert(passwordCredentials).values({
                    userId: createdUser.id,
                    passwordHash,
                });

                if (createdEmail === undefined) {
                    throw new Error("Email insert did not return a row");
                }

                await transaction.insert(emailVerificationTokens).values({
                    emailId: createdEmail.id,
                    tokenHash: verificationHash,
                    expiresAt: expiresFrom(now, 24 * 60 * 60 * 1_000),
                });
            });
        } catch (err) {
            if (String(err).includes("unique")) {
                throw new RegistryHttpError(
                    "USERNAME_UNAVAILABLE",
                    409,
                    "Username or email is unavailable.",
                );
            }

            throw err;
        }

        if (createdUser === undefined || createdEmail === undefined) {
            throw new Error("Signup transaction did not produce a user");
        }

        const verificationUrl = `${this.#config.publicUrl}/v1/auth/email/verify?token=${encodeURIComponent(verificationToken)}`;

        await this.#mailer.send(
            verificationEmail(createdEmail.email, verificationUrl),
        );

        return publicUser(createdUser, createdEmail, false);
    }

    async verifyEmail(token: string) {
        const tokenHash = await hashSecret(token, this.#config.tokenPepper);

        const now = this.#clock.now();

        const [verification] = await this.#database
            .select()
            .from(emailVerificationTokens)
            .where(
                and(
                    eq(emailVerificationTokens.tokenHash, tokenHash),
                    isNull(emailVerificationTokens.usedAt),
                    gt(emailVerificationTokens.expiresAt, now),
                ),
            )
            .limit(1);

        if (verification === undefined) {
            throw new RegistryHttpError(
                "AUTHENTICATION_FAILED",
                400,
                "Verification token is invalid, expired, or already used.",
            );
        }

        await this.#database.transaction(async (transaction) => {
            await transaction
                .update(emailVerificationTokens)
                .set({ usedAt: now })
                .where(eq(emailVerificationTokens.id, verification.id));

            await transaction
                .update(userEmails)
                .set({ verifiedAt: now })
                .where(eq(userEmails.id, verification.emailId));
        });

        return { verified: true };
    }

    async resendVerification(identifier: string): Promise<void> {
        const normalized = normalizeIdentity(identifier);

        const [identity] = await this.#database
            .select({ user: users, email: userEmails })
            .from(users)
            .innerJoin(userEmails, eq(userEmails.userId, users.id))
            .where(
                normalized.includes("@")
                    ? eq(userEmails.emailNormalized, normalized)
                    : eq(users.usernameNormalized, normalized),
            )
            .limit(1);

        // Enumeration resistance intentionally returns success for unknown identities.
        if (identity === undefined || identity.email.verifiedAt !== null) {
            return;
        }

        const token = randomSecret();

        await this.#database.insert(emailVerificationTokens).values({
            emailId: identity.email.id,
            tokenHash: await hashSecret(token, this.#config.tokenPepper),
            expiresAt: expiresFrom(this.#clock.now(), 24 * 60 * 60 * 1_000),
        });

        const url = `${this.#config.publicUrl}/v1/auth/email/verify?token=${encodeURIComponent(token)}`;

        await this.#mailer.send(verificationEmail(identity.email.email, url));
    }

    async login(identifier: string, password: string): Promise<LoginResult> {
        const normalized = normalizeIdentity(identifier);

        const [identity] = await this.#database
            .select({
                user: users,
                email: userEmails,
                password: passwordCredentials,
            })
            .from(users)
            .innerJoin(userEmails, eq(userEmails.userId, users.id))
            .innerJoin(
                passwordCredentials,
                eq(passwordCredentials.userId, users.id),
            )
            .where(
                normalized.includes("@")
                    ? eq(userEmails.emailNormalized, normalized)
                    : eq(users.usernameNormalized, normalized),
            )
            .limit(1);

        const valid =
            identity !== undefined &&
            (await verifyPassword(
                password,
                this.#config.passwordPepper,
                identity.password.passwordHash,
            ));

        if (
            !valid ||
            identity === undefined ||
            identity.user.disabledAt !== null
        ) {
            throw new RegistryHttpError(
                "AUTHENTICATION_FAILED",
                401,
                "Username, email, or password is incorrect.",
            );
        }

        if (identity.email.verifiedAt === null) {
            throw new RegistryHttpError(
                "EMAIL_NOT_VERIFIED",
                403,
                "Verify the primary email before signing in.",
            );
        }

        const [totp] = await this.#database
            .select()
            .from(totpCredentials)
            .where(
                and(
                    eq(totpCredentials.userId, identity.user.id),
                    isNotNull(totpCredentials.confirmedAt),
                ),
            )
            .limit(1);

        if (totp !== undefined) {
            const challenge = randomSecret();

            const expiresAt = expiresFrom(this.#clock.now(), 5 * 60 * 1_000);

            const [created] = await this.#database
                .insert(authChallenges)
                .values({
                    userId: identity.user.id,
                    kind: "totp_login",
                    challengeHash: await hashSecret(
                        challenge,
                        this.#config.tokenPepper,
                    ),
                    expiresAt,
                })
                .returning();

            return {
                state: "mfa_required",
                challengeId: `${created?.id}.${challenge}`,
                expiresAt: expiresAt.toISOString(),
            };
        }

        const created = await this.createAccessToken(identity.user.id, {
            name: "CLI login",
            scopes: defaultScopes,
            type: "personal",
        });

        return { state: "authenticated", token: created.token };
    }

    async loginSession(
        identifier: string,
        password: string,
    ): Promise<LoginResult | (CreatedSession & { state: "authenticated" })> {
        const login = await this.login(identifier, password);

        if (login.state === "mfa_required" || login.token === undefined) {
            return login;
        }

        const principal = await this.authenticate(
            new Request("http://registry.internal/session", {
                headers: { authorization: `Bearer ${login.token}` },
            }),
        );

        await this.revokeToken(principal.userId, principal.tokenId ?? "");

        return {
            state: "authenticated",
            ...(await this.createSession(principal.userId)),
        };
    }

    async completeTotpLogin(
        challengeValue: string,
        code: string,
    ): Promise<LoginResult> {
        const [id, secret] = challengeValue.split(".", 2);

        if (id === undefined || secret === undefined) {
            throw new RegistryHttpError(
                "MFA_INVALID",
                401,
                "MFA challenge is invalid.",
            );
        }

        const [challenge] = await this.#database
            .select()
            .from(authChallenges)
            .where(
                and(
                    eq(authChallenges.id, id),
                    eq(authChallenges.kind, "totp_login"),
                    isNull(authChallenges.usedAt),
                    gt(authChallenges.expiresAt, this.#clock.now()),
                ),
            )
            .limit(1);

        if (
            challenge?.userId === null ||
            challenge?.userId === undefined ||
            challenge.challengeHash !==
                (await hashSecret(secret, this.#config.tokenPepper))
        ) {
            throw new RegistryHttpError(
                "MFA_INVALID",
                401,
                "MFA challenge is invalid.",
            );
        }

        const [credential] = await this.#database
            .select()
            .from(totpCredentials)
            .where(eq(totpCredentials.userId, challenge.userId))
            .limit(1);

        if (credential === undefined || credential.confirmedAt === null) {
            throw new RegistryHttpError(
                "MFA_INVALID",
                401,
                "TOTP is not enabled.",
            );
        }

        const seed = await decryptSecret(
            credential.secretEncrypted,
            this.#config.sessionSecret,
        );

        const counter = await verifyTotp(
            seed,
            code,
            this.#clock.now().getTime(),
            credential.lastCounter,
        );

        if (counter === undefined) {
            throw new RegistryHttpError(
                "TOTP_INVALID",
                401,
                "TOTP code is invalid.",
            );
        }

        await this.#database.transaction(async (transaction) => {
            await transaction
                .update(totpCredentials)
                .set({ lastCounter: BigInt(counter) })
                .where(eq(totpCredentials.userId, challenge.userId ?? ""));

            await transaction
                .update(authChallenges)
                .set({ usedAt: this.#clock.now() })
                .where(eq(authChallenges.id, challenge.id));
        });

        const created = await this.createAccessToken(challenge.userId, {
            name: "MFA login",
            scopes: defaultScopes,
            type: "personal",
        });

        return { state: "authenticated", token: created.token };
    }

    async createAccessToken(
        userId: string,
        input: {
            name: string;
            scopes: readonly string[];
            type: "personal" | "automation";
            expiresAt?: Date;
            packageRestrictions?: readonly string[];
        },
    ) {
        const secret = randomSecret();

        const token = `wiz_pat_${secret}`;

        const tokenHash = await hashSecret(token, this.#config.tokenPepper);

        const [created] = await this.#database
            .insert(accessTokens)
            .values({
                userId,
                name: input.name,
                tokenPrefix: token.slice(0, 16),
                tokenHash,
                tokenType: input.type,
                packageRestrictions: [...(input.packageRestrictions ?? [])],
                ...(input.expiresAt === undefined
                    ? {}
                    : { expiresAt: input.expiresAt }),
            })
            .returning();

        if (created === undefined) {
            throw new Error("Token insert did not return a row");
        }

        if (input.scopes.length > 0) {
            await this.#database.insert(tokenScopes).values(
                [...new Set(input.scopes)].map((scope) => {
                    return { tokenId: created.id, scope };
                }),
            );
        }

        return {
            token,
            id: created.id,
            name: created.name,
            prefix: created.tokenPrefix,
            scopes: [...new Set(input.scopes)],
            ...(created.expiresAt === null
                ? {}
                : { expiresAt: created.expiresAt.toISOString() }),
        };
    }

    async authenticate(request: Request): Promise<AuthPrincipal> {
        const authorization = request.headers.get("authorization");

        if (authorization?.startsWith("Bearer ")) {
            return this.authenticateToken(authorization.slice(7));
        }

        const cookie = request.headers
            .get("cookie")
            ?.split(";")
            .map((entry) => {
                return entry.trim();
            })
            .find((entry) => {
                return entry.startsWith("wiz_session=");
            })
            ?.slice("wiz_session=".length);

        if (cookie !== undefined) {
            return this.authenticateSession(cookie, request);
        }

        throw authenticationRequired();
    }

    private async authenticateToken(token: string): Promise<AuthPrincipal> {
        const tokenHash = await hashSecret(token, this.#config.tokenPepper);

        const [record] = await this.#database
            .select()
            .from(accessTokens)
            .where(eq(accessTokens.tokenHash, tokenHash))
            .limit(1);

        if (record === undefined) {
            throw authenticationRequired();
        }

        if (record.revokedAt !== null) {
            throw new RegistryHttpError(
                "TOKEN_REVOKED",
                401,
                "Access token was revoked.",
            );
        }

        if (
            record.expiresAt !== null &&
            record.expiresAt <= this.#clock.now()
        ) {
            throw new RegistryHttpError(
                "TOKEN_EXPIRED",
                401,
                "Access token expired.",
            );
        }

        const scopes = await this.#database
            .select({ scope: tokenScopes.scope })
            .from(tokenScopes)
            .where(eq(tokenScopes.tokenId, record.id));

        await this.#database
            .update(accessTokens)
            .set({ lastUsedAt: this.#clock.now() })
            .where(eq(accessTokens.id, record.id));

        return {
            userId: record.userId,
            tokenId: record.id,
            scopes: scopes.map((entry) => {
                return entry.scope;
            }),
            packageRestrictions: record.packageRestrictions,
            recentAuthAt: this.#clock.now(),
        };
    }

    private async authenticateSession(
        value: string,
        request: Request,
    ): Promise<AuthPrincipal> {
        const [id, secret] = value.split(".", 2);

        if (id === undefined || secret === undefined) {
            throw authenticationRequired();
        }

        const [record] = await this.#database
            .select()
            .from(sessions)
            .where(eq(sessions.id, id))
            .limit(1);

        if (
            record === undefined ||
            record.revokedAt !== null ||
            record.expiresAt <= this.#clock.now() ||
            record.secretHash !==
                (await hashSecret(secret, this.#config.sessionSecret))
        ) {
            throw new RegistryHttpError(
                "SESSION_EXPIRED",
                401,
                "Session expired.",
            );
        }

        if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
            const csrfToken = request.headers.get("x-csrf-token");

            if (
                csrfToken === null ||
                record.csrfHash !==
                    (await hashSecret(csrfToken, this.#config.sessionSecret))
            ) {
                throw new RegistryHttpError(
                    "AUTHENTICATION_FAILED",
                    403,
                    "The CSRF token is missing or invalid.",
                );
            }
        }

        return {
            userId: record.userId,
            sessionId: record.id,
            scopes: defaultScopes,
            packageRestrictions: [],
            recentAuthAt: record.recentAuthAt,
        };
    }

    async createSession(userId: string): Promise<CreatedSession> {
        const secret = randomSecret();

        const csrfToken = randomSecret();

        const expiresAt = expiresFrom(
            this.#clock.now(),
            30 * 24 * 60 * 60 * 1_000,
        );

        const [created] = await this.#database
            .insert(sessions)
            .values({
                userId,
                secretHash: await hashSecret(
                    secret,
                    this.#config.sessionSecret,
                ),
                csrfHash: await hashSecret(
                    csrfToken,
                    this.#config.sessionSecret,
                ),
                expiresAt,
            })
            .returning();

        if (created === undefined) {
            throw new Error("Session insert did not return a row");
        }

        return {
            cookie: `${created.id}.${secret}`,
            csrfToken,
            expiresAt: expiresAt.toISOString(),
        };
    }

    async user(userId: string) {
        const [identity] = await this.#database
            .select({ user: users, email: userEmails })
            .from(users)
            .innerJoin(userEmails, eq(userEmails.userId, users.id))
            .where(and(eq(users.id, userId), eq(userEmails.isPrimary, true)))
            .limit(1);

        if (identity === undefined) {
            throw authenticationRequired();
        }

        const [totp] = await this.#database
            .select({ userId: totpCredentials.userId })
            .from(totpCredentials)
            .where(
                and(
                    eq(totpCredentials.userId, userId),
                    isNotNull(totpCredentials.confirmedAt),
                ),
            )
            .limit(1);

        return publicUser(identity.user, identity.email, totp !== undefined);
    }

    async listTokens(userId: string) {
        const records = await this.#database
            .select()
            .from(accessTokens)
            .where(eq(accessTokens.userId, userId))
            .orderBy(desc(accessTokens.createdAt));

        return Promise.all(
            records.map(async (record) => {
                const scopes = await this.#database
                    .select({ scope: tokenScopes.scope })
                    .from(tokenScopes)
                    .where(eq(tokenScopes.tokenId, record.id));

                return {
                    id: record.id,
                    name: record.name,
                    prefix: record.tokenPrefix,
                    scopes: scopes.map((entry) => {
                        return entry.scope;
                    }),
                    ...(record.expiresAt === null
                        ? {}
                        : { expiresAt: record.expiresAt.toISOString() }),
                    ...(record.lastUsedAt === null
                        ? {}
                        : { lastUsedAt: record.lastUsedAt.toISOString() }),
                };
            }),
        );
    }

    async revokeToken(userId: string, tokenId: string): Promise<void> {
        await this.#database
            .update(accessTokens)
            .set({ revokedAt: this.#clock.now() })
            .where(
                and(
                    eq(accessTokens.id, tokenId),
                    eq(accessTokens.userId, userId),
                ),
            );
    }

    async beginTotp(userId: string, username: string) {
        const secret = createTotpSecret();

        await this.#database
            .insert(totpCredentials)
            .values({
                userId,
                secretEncrypted: await encryptSecret(
                    secret,
                    this.#config.sessionSecret,
                ),
            })
            .onConflictDoUpdate({
                target: totpCredentials.userId,
                set: {
                    secretEncrypted: await encryptSecret(
                        secret,
                        this.#config.sessionSecret,
                    ),
                    confirmedAt: null,
                    lastCounter: null,
                },
            });

        return {
            secret,
            uri: `otpauth://totp/${encodeURIComponent(this.#config.webauthn.rpName)}:${encodeURIComponent(username)}?secret=${secret}&issuer=${encodeURIComponent(this.#config.webauthn.rpName)}&algorithm=SHA1&digits=6&period=30`,
        };
    }

    async confirmTotp(
        userId: string,
        code: string,
    ): Promise<readonly string[]> {
        const [credential] = await this.#database
            .select()
            .from(totpCredentials)
            .where(eq(totpCredentials.userId, userId))
            .limit(1);

        if (credential === undefined) {
            throw new RegistryHttpError(
                "TOTP_INVALID",
                400,
                "TOTP setup was not started.",
            );
        }

        const seed = await decryptSecret(
            credential.secretEncrypted,
            this.#config.sessionSecret,
        );

        const counter = await verifyTotp(
            seed,
            code,
            this.#clock.now().getTime(),
        );

        if (counter === undefined) {
            throw new RegistryHttpError(
                "TOTP_INVALID",
                401,
                "TOTP code is invalid.",
            );
        }

        await this.#database
            .update(totpCredentials)
            .set({
                confirmedAt: this.#clock.now(),
                // Enrollment proves possession; replay tracking begins with authentication.
                lastCounter: null,
            })
            .where(eq(totpCredentials.userId, userId));

        return this.regenerateRecoveryCodes(userId);
    }

    async regenerateRecoveryCodes(userId: string): Promise<readonly string[]> {
        const codes = Array.from({ length: 10 }, () => {
            return `${randomSecret(5).slice(0, 5)}-${randomSecret(5).slice(0, 5)}`;
        });

        await this.#database.transaction(async (transaction) => {
            await transaction
                .delete(recoveryCodes)
                .where(eq(recoveryCodes.userId, userId));

            await transaction.insert(recoveryCodes).values(
                await Promise.all(
                    codes.map(async (code) => {
                        return {
                            userId,
                            codeHash: await hashSecret(
                                code,
                                this.#config.tokenPepper,
                            ),
                        };
                    }),
                ),
            );
        });

        return codes;
    }

    async completeRecoveryLogin(
        challengeValue: string,
        code: string,
    ): Promise<LoginResult> {
        const [id, secret] = challengeValue.split(".", 2);

        if (id === undefined || secret === undefined) {
            throw new RegistryHttpError(
                "RECOVERY_CODE_INVALID",
                401,
                "Recovery challenge is invalid.",
            );
        }

        const [challenge] = await this.#database
            .select()
            .from(authChallenges)
            .where(
                and(
                    eq(authChallenges.id, id),
                    eq(authChallenges.kind, "totp_login"),
                    isNull(authChallenges.usedAt),
                    gt(authChallenges.expiresAt, this.#clock.now()),
                ),
            )
            .limit(1);

        if (
            challenge?.userId === null ||
            challenge?.userId === undefined ||
            challenge.challengeHash !==
                (await hashSecret(secret, this.#config.tokenPepper))
        ) {
            throw new RegistryHttpError(
                "RECOVERY_CODE_INVALID",
                401,
                "Recovery challenge is invalid.",
            );
        }

        const codeHash = await hashSecret(code, this.#config.tokenPepper);

        const [record] = await this.#database
            .select()
            .from(recoveryCodes)
            .where(
                and(
                    eq(recoveryCodes.userId, challenge.userId),
                    eq(recoveryCodes.codeHash, codeHash),
                    isNull(recoveryCodes.usedAt),
                ),
            )
            .limit(1);

        if (record === undefined) {
            throw new RegistryHttpError(
                "RECOVERY_CODE_INVALID",
                401,
                "Recovery code is invalid or already used.",
            );
        }

        await this.#database.transaction(async (transaction) => {
            await transaction
                .update(recoveryCodes)
                .set({ usedAt: this.#clock.now() })
                .where(eq(recoveryCodes.id, record.id));

            await transaction
                .update(authChallenges)
                .set({ usedAt: this.#clock.now() })
                .where(eq(authChallenges.id, challenge.id));
        });

        const created = await this.createAccessToken(challenge.userId, {
            name: "Recovery-code login",
            scopes: defaultScopes,
            type: "personal",
        });

        return { state: "authenticated", token: created.token };
    }

    async disableTotp(userId: string): Promise<void> {
        await this.#database.transaction(async (transaction) => {
            await transaction
                .delete(totpCredentials)
                .where(eq(totpCredentials.userId, userId));

            await transaction
                .delete(recoveryCodes)
                .where(eq(recoveryCodes.userId, userId));
        });
    }

    async requestPasswordReset(identifier: string): Promise<void> {
        const normalized = normalizeIdentity(identifier);

        const [identity] = await this.#database
            .select({ user: users, email: userEmails })
            .from(users)
            .innerJoin(userEmails, eq(userEmails.userId, users.id))
            .where(
                normalized.includes("@")
                    ? eq(userEmails.emailNormalized, normalized)
                    : eq(users.usernameNormalized, normalized),
            )
            .limit(1);

        if (identity === undefined) {
            return;
        }

        const token = randomSecret();

        await this.#database.insert(passwordResetTokens).values({
            userId: identity.user.id,
            tokenHash: await hashSecret(token, this.#config.tokenPepper),
            expiresAt: expiresFrom(this.#clock.now(), 60 * 60 * 1_000),
        });

        const url = `${this.#config.publicUrl}/reset-password?token=${encodeURIComponent(token)}`;

        await this.#mailer.send(passwordResetEmail(identity.email.email, url));
    }

    async confirmPasswordReset(token: string, password: string): Promise<void> {
        if (password.length < 12 || password.length > 512) {
            throw validationFailed(
                "Password must contain between 12 and 512 characters.",
            );
        }

        const tokenHash = await hashSecret(token, this.#config.tokenPepper);

        const [record] = await this.#database
            .select()
            .from(passwordResetTokens)
            .where(
                and(
                    eq(passwordResetTokens.tokenHash, tokenHash),
                    isNull(passwordResetTokens.usedAt),
                    gt(passwordResetTokens.expiresAt, this.#clock.now()),
                ),
            )
            .limit(1);

        if (record === undefined) {
            throw new RegistryHttpError(
                "AUTHENTICATION_FAILED",
                400,
                "Password reset token is invalid, expired, or already used.",
            );
        }

        await this.#database.transaction(async (transaction) => {
            await transaction
                .update(passwordCredentials)
                .set({
                    passwordHash: await hashPassword(
                        password,
                        this.#config.passwordPepper,
                    ),
                    changedAt: this.#clock.now(),
                })
                .where(eq(passwordCredentials.userId, record.userId));

            await transaction
                .update(passwordResetTokens)
                .set({ usedAt: this.#clock.now() })
                .where(eq(passwordResetTokens.id, record.id));

            await transaction
                .update(sessions)
                .set({ revokedAt: this.#clock.now() })
                .where(eq(sessions.userId, record.userId));

            await transaction
                .update(accessTokens)
                .set({ revokedAt: this.#clock.now() })
                .where(eq(accessTokens.userId, record.userId));
        });
    }
}
