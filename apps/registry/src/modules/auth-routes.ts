import { Elysia, t } from "elysia";
import { assertTokenScopes } from "../security/authorization.ts";
import type { RegistryServices } from "../services/container.ts";

const credentials = t.Object({
    identifier: t.String({ minLength: 1, maxLength: 320 }),
    password: t.String({ minLength: 12, maxLength: 512 }),
});

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

/** Auth routes remain thin; credential and MFA semantics live in AuthService. */
export function authRoutes(services: RegistryServices) {
    return new Elysia({ name: "registry-auth-routes" })
        .post(
            "/v1/auth/signup",
            async ({ body, set }) => {
                const user = await services.auth.signup(body);

                set.status = 201;

                return user;
            },
            {
                body: t.Object({
                    username: t.String({ minLength: 3, maxLength: 64 }),
                    email: t.String({ format: "email", maxLength: 320 }),
                    password: t.String({ minLength: 12, maxLength: 512 }),
                }),
                ...operation(
                    "signup",
                    "Create a registry account",
                    "Authentication",
                ),
            },
        )
        .post(
            "/v1/auth/login",
            ({ body }) => {
                return services.auth.login(body.identifier, body.password);
            },
            {
                body: credentials,
                ...operation(
                    "login",
                    "Authenticate with a password",
                    "Authentication",
                ),
            },
        )
        .post(
            "/v1/auth/session",
            async ({ body, set }) => {
                const result = await services.auth.loginSession(
                    body.identifier,
                    body.password,
                );

                if ("cookie" in result) {
                    set.headers["set-cookie"] =
                        `wiz_session=${result.cookie}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`;
                }

                return result;
            },
            {
                body: credentials,
                ...operation(
                    "createSession",
                    "Create a browser session",
                    "Sessions",
                ),
            },
        )
        .post(
            "/v1/auth/logout",
            async ({ request, set }) => {
                const principal = await services.auth.authenticate(request);

                await services.accounts.logout(principal);

                set.status = 204;
                set.headers["set-cookie"] =
                    "wiz_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
            },
            operation(
                "logout",
                "Revoke the current login",
                "Authentication",
                true,
            ),
        )
        .post(
            "/v1/auth/logout-all",
            async ({ request, set }) => {
                const principal = await services.auth.authenticate(request);

                await services.accounts.logoutAll(principal.userId);

                set.status = 204;
            },
            operation(
                "logoutAll",
                "Revoke every login",
                "Authentication",
                true,
            ),
        )
        .post(
            "/v1/auth/device",
            () => {
                return services.accounts.beginDeviceAuthorization();
            },
            operation(
                "beginDeviceAuthorization",
                "Begin CLI device authorization",
                "Authentication",
            ),
        )
        .post(
            "/v1/auth/device/authorize",
            async ({ request, body }) => {
                const principal = await services.auth.authenticate(request);

                await services.accounts.approveDevice(principal, body.userCode);

                return { authorized: true };
            },
            {
                body: t.Object({
                    userCode: t.String({
                        minLength: 8,
                        maxLength: 8,
                        pattern: "^[A-F0-9]{8}$",
                    }),
                }),
                ...operation(
                    "authorizeDevice",
                    "Authorize a CLI device",
                    "Authentication",
                    true,
                ),
            },
        )
        .post(
            "/v1/auth/device/token",
            ({ body }) => {
                return services.accounts.exchangeDeviceCode(body.deviceCode);
            },
            {
                body: t.Object({ deviceCode: t.String({ minLength: 16 }) }),
                ...operation(
                    "exchangeDeviceAuthorization",
                    "Exchange a device code",
                    "Authentication",
                ),
            },
        )
        .post(
            "/v1/auth/mfa/totp",
            ({ body }) => {
                return services.auth.completeTotpLogin(
                    body.challenge,
                    body.code,
                );
            },
            {
                body: t.Object({
                    challenge: t.String({ minLength: 1 }),
                    code: t.String({ pattern: "^[0-9]{6}$" }),
                }),
                ...operation(
                    "completeTotpLogin",
                    "Complete a TOTP login",
                    "MFA",
                ),
            },
        )
        .post(
            "/v1/auth/mfa/recovery",
            ({ body }) => {
                return services.auth.completeRecoveryLogin(
                    body.challenge,
                    body.code,
                );
            },
            {
                body: t.Object({
                    challenge: t.String({ minLength: 1 }),
                    code: t.String({ minLength: 8, maxLength: 64 }),
                }),
                ...operation(
                    "completeRecoveryLogin",
                    "Complete login with a recovery code",
                    "MFA",
                ),
            },
        )
        .post(
            "/v1/auth/email/verify",
            ({ body }) => {
                return services.auth.verifyEmail(body.token);
            },
            {
                body: t.Object({ token: t.String({ minLength: 16 }) }),
                ...operation(
                    "verifyEmail",
                    "Verify an email address",
                    "Authentication",
                ),
            },
        )
        .get(
            "/v1/auth/email/verify",
            ({ query }) => {
                return services.auth.verifyEmail(query.token);
            },
            {
                query: t.Object({ token: t.String({ minLength: 16 }) }),
                ...operation(
                    "verifyEmailLink",
                    "Verify an email link",
                    "Authentication",
                ),
            },
        )
        .post(
            "/v1/auth/email/resend",
            async ({ body }) => {
                await services.auth.resendVerification(body.identifier);

                return { accepted: true };
            },
            {
                body: t.Object({
                    identifier: t.String({ minLength: 1, maxLength: 320 }),
                }),
                ...operation(
                    "resendEmailVerification",
                    "Resend email verification",
                    "Authentication",
                ),
            },
        )
        .post(
            "/v1/auth/password/reset/request",
            async ({ body }) => {
                await services.auth.requestPasswordReset(body.identifier);

                return { accepted: true };
            },
            {
                body: t.Object({
                    identifier: t.String({ minLength: 1, maxLength: 320 }),
                }),
                ...operation(
                    "requestPasswordReset",
                    "Request a password reset",
                    "Authentication",
                ),
            },
        )
        .post(
            "/v1/auth/password/reset/confirm",
            async ({ body }) => {
                await services.auth.confirmPasswordReset(
                    body.token,
                    body.password,
                );

                return { reset: true };
            },
            {
                body: t.Object({
                    token: t.String({ minLength: 16 }),
                    password: t.String({ minLength: 12, maxLength: 512 }),
                }),
                ...operation(
                    "confirmPasswordReset",
                    "Reset a password",
                    "Authentication",
                ),
            },
        )
        .get(
            "/v1/users/me",
            async ({ request }) => {
                const principal = await services.auth.authenticate(request);

                return services.auth.user(principal.userId);
            },
            operation("getCurrentUser", "Get the current user", "Users", true),
        )
        .patch(
            "/v1/users/me",
            async ({ request, body }) => {
                const principal = await services.auth.authenticate(request);

                return services.accounts.updateProfile(principal, body);
            },
            {
                body: t.Object({
                    username: t.Optional(
                        t.String({ minLength: 3, maxLength: 64 }),
                    ),
                    displayName: t.Optional(
                        t.Union([
                            t.String({ minLength: 1, maxLength: 100 }),
                            t.Null(),
                        ]),
                    ),
                }),
                ...operation(
                    "updateCurrentUser",
                    "Update the current user",
                    "Users",
                    true,
                ),
            },
        )
        .get(
            "/v1/users/:username",
            ({ params }) => {
                return services.accounts.publicUser(params.username);
            },
            {
                params: t.Object({ username: t.String() }),
                ...operation("getUser", "Get a public user profile", "Users"),
            },
        )
        .get(
            "/v1/users/me/sessions",
            async ({ request }) => {
                const principal = await services.auth.authenticate(request);

                return {
                    items: await services.accounts.listSessions(
                        principal.userId,
                    ),
                };
            },
            operation(
                "listSessions",
                "List browser sessions",
                "Sessions",
                true,
            ),
        )
        .delete(
            "/v1/users/me/sessions/:sessionId",
            async ({ request, params, set }) => {
                const principal = await services.auth.authenticate(request);

                await services.accounts.revokeSession(
                    principal.userId,
                    params.sessionId,
                );

                set.status = 204;
            },
            {
                params: t.Object({ sessionId: t.String({ format: "uuid" }) }),
                ...operation(
                    "revokeSession",
                    "Revoke a browser session",
                    "Sessions",
                    true,
                ),
            },
        )
        .get(
            "/v1/users/me/tokens",
            async ({ request }) => {
                const principal = await services.auth.authenticate(request);

                return {
                    items: await services.auth.listTokens(principal.userId),
                };
            },
            operation("listAccessTokens", "List access tokens", "Tokens", true),
        )
        .post(
            "/v1/users/me/tokens",
            async ({ request, body, set }) => {
                const principal = await services.auth.authenticate(request);

                assertTokenScopes(principal.scopes, body.scopes);

                const token = await services.auth.createAccessToken(
                    principal.userId,
                    {
                        name: body.name,
                        scopes: body.scopes,
                        type: body.type,
                        ...(body.expiresAt === undefined
                            ? {}
                            : { expiresAt: new Date(body.expiresAt) }),
                        ...(body.packages === undefined
                            ? {}
                            : { packageRestrictions: body.packages }),
                    },
                );

                set.status = 201;

                return token;
            },
            {
                body: t.Object({
                    name: t.String({ minLength: 1, maxLength: 100 }),
                    scopes: t.Array(
                        t.String({ minLength: 1, maxLength: 100 }),
                        {
                            maxItems: 32,
                        },
                    ),
                    type: t.Union([
                        t.Literal("personal"),
                        t.Literal("automation"),
                    ]),
                    expiresAt: t.Optional(t.String({ format: "date-time" })),
                    packages: t.Optional(
                        t.Array(t.String(), { maxItems: 100 }),
                    ),
                }),
                ...operation(
                    "createAccessToken",
                    "Create an access token",
                    "Tokens",
                    true,
                ),
            },
        )
        .get(
            "/v1/users/me/tokens/:tokenId",
            async ({ request, params }) => {
                const principal = await services.auth.authenticate(request);

                return services.accounts.token(
                    principal.userId,
                    params.tokenId,
                );
            },
            {
                params: t.Object({ tokenId: t.String({ format: "uuid" }) }),
                ...operation(
                    "getAccessToken",
                    "Get access-token metadata",
                    "Tokens",
                    true,
                ),
            },
        )
        .patch(
            "/v1/users/me/tokens/:tokenId",
            async ({ request, params, body }) => {
                const principal = await services.auth.authenticate(request);

                return services.accounts.renameToken(
                    principal.userId,
                    params.tokenId,
                    body.name,
                );
            },
            {
                params: t.Object({ tokenId: t.String({ format: "uuid" }) }),
                body: t.Object({
                    name: t.String({ minLength: 1, maxLength: 100 }),
                }),
                ...operation(
                    "updateAccessToken",
                    "Update access-token metadata",
                    "Tokens",
                    true,
                ),
            },
        )
        .delete(
            "/v1/users/me/tokens/:tokenId",
            async ({ request, params, set }) => {
                const principal = await services.auth.authenticate(request);

                await services.auth.revokeToken(
                    principal.userId,
                    params.tokenId,
                );

                set.status = 204;
            },
            {
                params: t.Object({ tokenId: t.String({ format: "uuid" }) }),
                ...operation(
                    "revokeAccessToken",
                    "Revoke an access token",
                    "Tokens",
                    true,
                ),
            },
        )
        .post(
            "/v1/auth/totp/setup",
            async ({ request }) => {
                const principal = await services.auth.authenticate(request);

                const user = await services.auth.user(principal.userId);

                return services.auth.beginTotp(principal.userId, user.username);
            },
            operation("beginTotpSetup", "Begin TOTP enrollment", "MFA", true),
        )
        .post(
            "/v1/auth/totp/confirm",
            async ({ request, body }) => {
                const principal = await services.auth.authenticate(request);

                return {
                    recoveryCodes: await services.auth.confirmTotp(
                        principal.userId,
                        body.code,
                    ),
                };
            },
            {
                body: t.Object({ code: t.String({ pattern: "^[0-9]{6}$" }) }),
                ...operation(
                    "confirmTotpSetup",
                    "Confirm TOTP enrollment",
                    "MFA",
                    true,
                ),
            },
        )
        .post(
            "/v1/auth/recovery-codes/regenerate",
            async ({ request }) => {
                const principal = await services.auth.authenticate(request);

                return {
                    recoveryCodes: await services.auth.regenerateRecoveryCodes(
                        principal.userId,
                    ),
                };
            },
            operation(
                "regenerateRecoveryCodes",
                "Regenerate recovery codes",
                "MFA",
                true,
            ),
        )
        .delete(
            "/v1/auth/totp",
            async ({ request, set }) => {
                const principal = await services.auth.authenticate(request);

                await services.auth.disableTotp(principal.userId);

                set.status = 204;
            },
            operation(
                "disableTotp",
                "Disable TOTP and recovery codes",
                "MFA",
                true,
            ),
        );
}
