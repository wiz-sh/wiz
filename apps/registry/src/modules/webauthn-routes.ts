import type {
    AuthenticationResponseJSON,
    RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { Elysia, t } from "elysia";
import type { RegistryServices } from "../services/container.ts";

const clientExtensions = t.Record(t.String(), t.Unknown());

const authenticatorResponse = t.Object({
    clientDataJSON: t.String(),
    authenticatorData: t.Optional(t.String()),
    signature: t.Optional(t.String()),
    userHandle: t.Optional(t.Union([t.String(), t.Null()])),
    attestationObject: t.Optional(t.String()),
    transports: t.Optional(t.Array(t.String())),
});

const credentialResponse = t.Object({
    id: t.String(),
    rawId: t.String(),
    type: t.Literal("public-key"),
    response: authenticatorResponse,
    clientExtensionResults: clientExtensions,
    authenticatorAttachment: t.Optional(
        t.Union([t.Literal("cross-platform"), t.Literal("platform"), t.Null()]),
    ),
});

function options(operationId: string, summary: string, secured = false) {
    return {
        detail: {
            operationId,
            summary,
            description: summary,
            tags: ["WebAuthn"],
            ...(secured ? { security: [{ bearerAuth: [] }] } : {}),
        },
    };
}

export function webauthnRoutes(services: RegistryServices) {
    return new Elysia({ name: "registry-webauthn-routes" })
        .post(
            "/v1/auth/webauthn/registration/options",
            async ({ request }) => {
                const principal = await services.auth.authenticate(request);

                return services.webauthn.registrationOptions(principal);
            },
            options(
                "createWebAuthnRegistrationOptions",
                "Create passkey registration options",
                true,
            ),
        )
        .post(
            "/v1/auth/webauthn/registration/verify",
            async ({ request, body }) => {
                const principal = await services.auth.authenticate(request);

                return services.webauthn.verifyRegistration(
                    principal,
                    body.challengeId,
                    body.response as RegistrationResponseJSON,
                    body.name,
                );
            },
            {
                body: t.Object({
                    challengeId: t.String({ format: "uuid" }),
                    name: t.Optional(
                        t.String({ minLength: 1, maxLength: 100 }),
                    ),
                    response: credentialResponse,
                }),
                ...options(
                    "verifyWebAuthnRegistration",
                    "Verify and store a passkey",
                    true,
                ),
            },
        )
        .post(
            "/v1/auth/webauthn/authentication/options",
            ({ body }) => {
                return services.webauthn.authenticationOptions(body.identifier);
            },
            {
                body: t.Object({
                    identifier: t.Optional(
                        t.String({ minLength: 1, maxLength: 320 }),
                    ),
                }),
                ...options(
                    "createWebAuthnAuthenticationOptions",
                    "Create passkey authentication options",
                ),
            },
        )
        .post(
            "/v1/auth/webauthn/authentication/verify",
            ({ body }) => {
                return services.webauthn.verifyAuthentication(
                    body.challengeId,
                    body.response as AuthenticationResponseJSON,
                );
            },
            {
                body: t.Object({
                    challengeId: t.String({ format: "uuid" }),
                    response: credentialResponse,
                }),
                ...options(
                    "verifyWebAuthnAuthentication",
                    "Authenticate with a passkey",
                ),
            },
        )
        .get(
            "/v1/users/me/webauthn-credentials",
            async ({ request }) => {
                const principal = await services.auth.authenticate(request);

                return { items: await services.webauthn.list(principal) };
            },
            options(
                "listWebAuthnCredentials",
                "List passkey credentials",
                true,
            ),
        )
        .delete(
            "/v1/users/me/webauthn-credentials/:credentialId",
            async ({ request, params, set }) => {
                const principal = await services.auth.authenticate(request);

                await services.webauthn.remove(principal, params.credentialId);

                set.status = 204;
            },
            {
                params: t.Object({
                    credentialId: t.String({ format: "uuid" }),
                }),
                ...options(
                    "removeWebAuthnCredential",
                    "Remove a passkey credential",
                    true,
                ),
            },
        )
        .patch(
            "/v1/users/me/webauthn-credentials/:credentialId",
            async ({ request, params, body }) => {
                const principal = await services.auth.authenticate(request);

                return services.webauthn.rename(
                    principal,
                    params.credentialId,
                    body.name,
                );
            },
            {
                params: t.Object({
                    credentialId: t.String({ format: "uuid" }),
                }),
                body: t.Object({
                    name: t.String({ minLength: 1, maxLength: 100 }),
                }),
                ...options(
                    "updateWebAuthnCredential",
                    "Rename a passkey credential",
                    true,
                ),
            },
        );
}
