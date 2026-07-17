import {
    type AuthenticationResponseJSON,
    generateAuthenticationOptions,
    generateRegistrationOptions,
    type RegistrationResponseJSON,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { RegistryServerConfig } from "../config/types.ts";
import type { RegistryDatabase } from "../database/client.ts";
import {
    authChallenges,
    users,
    webauthnCredentials,
} from "../database/schema.ts";
import { RegistryHttpError } from "../middleware/errors.ts";
import { hashSecret } from "../security/crypto.ts";
import { normalizeIdentity } from "../security/names.ts";
import type { AuthPrincipal, AuthService } from "./auth-service.ts";

function credentialId(value: Uint8Array): string {
    return Buffer.from(value).toString("base64url");
}

function credentialBytes(value: string): Uint8Array {
    return new Uint8Array(Buffer.from(value, "base64url"));
}

export class WebAuthnService {
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

    async registrationOptions(principal: AuthPrincipal) {
        const user = await this.#auth.user(principal.userId);

        const credentials = await this.#database
            .select()
            .from(webauthnCredentials)
            .where(eq(webauthnCredentials.userId, principal.userId));

        const options = await generateRegistrationOptions({
            rpName: this.#config.webauthn.rpName,
            rpID: this.#config.webauthn.rpId,
            userID: Uint8Array.from(Buffer.from(principal.userId)),
            userName: user.username,
            userDisplayName: user.username,
            attestationType: "none",
            authenticatorSelection: {
                residentKey: "preferred",
                userVerification: "required",
            },
            excludeCredentials: credentials.map((credential) => {
                return {
                    id: credentialId(credential.credentialId),
                    transports: credential.transports as never,
                };
            }),
        });

        const [challenge] = await this.#database
            .insert(authChallenges)
            .values({
                userId: principal.userId,
                kind: "webauthn_registration",
                challengeHash: await hashSecret(
                    options.challenge,
                    this.#config.tokenPepper,
                ),
                payload: { challenge: options.challenge },
                expiresAt: new Date(Date.now() + 5 * 60 * 1_000),
            })
            .returning();

        return { challengeId: challenge?.id, options };
    }

    async verifyRegistration(
        principal: AuthPrincipal,
        challengeId: string,
        response: RegistrationResponseJSON,
        name = "Passkey",
    ) {
        const challenge = await this.challenge(
            challengeId,
            "webauthn_registration",
            principal.userId,
        );

        const expectedChallenge = String(challenge.payload.challenge ?? "");

        try {
            const verification = await verifyRegistrationResponse({
                response,
                expectedChallenge,
                expectedOrigin: this.#config.webauthn.origin,
                expectedRPID: this.#config.webauthn.rpId,
                requireUserVerification: true,
            });

            if (!verification.verified) {
                throw new Error("WebAuthn registration was not verified");
            }

            const credential = verification.registrationInfo.credential;

            const [created] = await this.#database
                .insert(webauthnCredentials)
                .values({
                    userId: principal.userId,
                    credentialId: credentialBytes(credential.id),
                    publicKey: Uint8Array.from(credential.publicKey),
                    counter: BigInt(credential.counter),
                    transports: credential.transports ?? [],
                    deviceType:
                        verification.registrationInfo.credentialDeviceType,
                    backedUp: verification.registrationInfo.credentialBackedUp,
                    name,
                })
                .returning();

            await this.consumeChallenge(challenge.id);

            return {
                id: created?.id,
                name: created?.name,
                createdAt: created?.createdAt.toISOString(),
            };
        } catch (err) {
            throw new RegistryHttpError(
                "WEBAUTHN_VERIFICATION_FAILED",
                401,
                "Passkey registration could not be verified.",
                {
                    cause:
                        err instanceof Error ? err.name : "VerificationError",
                },
            );
        }
    }

    async authenticationOptions(identifier?: string) {
        const normalized =
            identifier === undefined
                ? undefined
                : normalizeIdentity(identifier);

        const [user] =
            normalized === undefined
                ? []
                : await this.#database
                      .select()
                      .from(users)
                      .where(eq(users.usernameNormalized, normalized))
                      .limit(1);

        const credentials =
            user === undefined
                ? []
                : await this.#database
                      .select()
                      .from(webauthnCredentials)
                      .where(eq(webauthnCredentials.userId, user.id));

        const options = await generateAuthenticationOptions({
            rpID: this.#config.webauthn.rpId,
            userVerification: "required",
            ...(user === undefined
                ? {}
                : {
                      allowCredentials: credentials.map((credential) => {
                          return {
                              id: credentialId(credential.credentialId),
                              transports: credential.transports as never,
                          };
                      }),
                  }),
        });

        const [challenge] = await this.#database
            .insert(authChallenges)
            .values({
                userId: user?.id,
                kind: "webauthn_authentication",
                challengeHash: await hashSecret(
                    options.challenge,
                    this.#config.tokenPepper,
                ),
                payload: { challenge: options.challenge },
                expiresAt: new Date(Date.now() + 5 * 60 * 1_000),
            })
            .returning();

        return { challengeId: challenge?.id, options };
    }

    async verifyAuthentication(
        challengeId: string,
        response: AuthenticationResponseJSON,
    ) {
        const challenge = await this.challenge(
            challengeId,
            "webauthn_authentication",
        );

        const records = await this.#database.select().from(webauthnCredentials);

        const credential = records.find((record) => {
            return credentialId(record.credentialId) === response.id;
        });

        if (
            credential === undefined ||
            (challenge.userId !== null &&
                challenge.userId !== credential.userId)
        ) {
            throw new RegistryHttpError(
                "WEBAUTHN_VERIFICATION_FAILED",
                401,
                "Passkey authentication could not be verified.",
            );
        }

        try {
            const verification = await verifyAuthenticationResponse({
                response,
                expectedChallenge: String(challenge.payload.challenge ?? ""),
                expectedOrigin: this.#config.webauthn.origin,
                expectedRPID: this.#config.webauthn.rpId,
                credential: {
                    id: credentialId(credential.credentialId),
                    publicKey: Uint8Array.from(credential.publicKey),
                    counter: Number(credential.counter),
                    transports: credential.transports as never,
                },
                requireUserVerification: true,
            });

            if (!verification.verified) {
                throw new Error("WebAuthn assertion was not verified");
            }

            await this.#database.transaction(async (transaction) => {
                await transaction
                    .update(webauthnCredentials)
                    .set({
                        counter: BigInt(
                            verification.authenticationInfo.newCounter,
                        ),
                        lastUsedAt: new Date(),
                    })
                    .where(eq(webauthnCredentials.id, credential.id));

                await transaction
                    .update(authChallenges)
                    .set({ usedAt: new Date() })
                    .where(eq(authChallenges.id, challenge.id));
            });

            const token = await this.#auth.createAccessToken(
                credential.userId,
                {
                    name: "Passkey login",
                    type: "personal",
                    scopes: [
                        "profile:read",
                        "packages:read",
                        "packages:write",
                        "orgs:write",
                    ],
                },
            );

            return { state: "authenticated" as const, token: token.token };
        } catch (err) {
            if (err instanceof RegistryHttpError) {
                throw err;
            }

            throw new RegistryHttpError(
                "WEBAUTHN_VERIFICATION_FAILED",
                401,
                "Passkey authentication could not be verified.",
            );
        }
    }

    async list(principal: AuthPrincipal) {
        const records = await this.#database
            .select()
            .from(webauthnCredentials)
            .where(eq(webauthnCredentials.userId, principal.userId));

        return records.map((credential) => {
            return {
                id: credential.id,
                name: credential.name,
                deviceType: credential.deviceType,
                backedUp: credential.backedUp,
                createdAt: credential.createdAt.toISOString(),
                ...(credential.lastUsedAt === null
                    ? {}
                    : { lastUsedAt: credential.lastUsedAt.toISOString() }),
            };
        });
    }

    async remove(
        principal: AuthPrincipal,
        credentialIdValue: string,
    ): Promise<void> {
        await this.#database
            .delete(webauthnCredentials)
            .where(
                and(
                    eq(webauthnCredentials.id, credentialIdValue),
                    eq(webauthnCredentials.userId, principal.userId),
                ),
            );
    }

    async rename(
        principal: AuthPrincipal,
        credentialIdValue: string,
        name: string,
    ) {
        const [credential] = await this.#database
            .update(webauthnCredentials)
            .set({ name })
            .where(
                and(
                    eq(webauthnCredentials.id, credentialIdValue),
                    eq(webauthnCredentials.userId, principal.userId),
                ),
            )
            .returning();

        if (credential === undefined) {
            throw new RegistryHttpError(
                "RESOURCE_NOT_FOUND",
                404,
                "Passkey credential was not found.",
            );
        }

        return {
            id: credential.id,
            name: credential.name,
            deviceType: credential.deviceType,
            backedUp: credential.backedUp,
            createdAt: credential.createdAt.toISOString(),
        };
    }

    private async challenge(id: string, kind: string, userId?: string) {
        const [challenge] = await this.#database
            .select()
            .from(authChallenges)
            .where(
                and(
                    eq(authChallenges.id, id),
                    eq(authChallenges.kind, kind),
                    isNull(authChallenges.usedAt),
                    gt(authChallenges.expiresAt, new Date()),
                    ...(userId === undefined
                        ? []
                        : [eq(authChallenges.userId, userId)]),
                ),
            )
            .limit(1);

        if (challenge === undefined) {
            throw new RegistryHttpError(
                "WEBAUTHN_CHALLENGE_EXPIRED",
                400,
                "WebAuthn challenge is unavailable or expired.",
            );
        }

        return challenge;
    }

    private async consumeChallenge(id: string): Promise<void> {
        await this.#database
            .update(authChallenges)
            .set({ usedAt: new Date() })
            .where(eq(authChallenges.id, id));
    }
}
