import { chromium } from "@playwright/test";
import { RegistryClient, RegistryError } from "@wiz/registry-client";
import { createVerifiedUser } from "../apps/registry/tests/e2e/helpers.e2e.ts";

interface RegistrationEnvelope {
    challengeId: string;
    options: Record<string, unknown>;
}

interface AuthenticationEnvelope {
    challengeId: string;
    options: Record<string, unknown>;
}

const registryUrl =
    process.env.WIZ_REGISTRY_E2E_URL ?? "http://registry.test.localhost:53000";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

const user = await createVerifiedUser("passkey");

const browser = await chromium.launch({ headless: true });

const context = await browser.newContext();

const page = await context.newPage();

const session = await context.newCDPSession(page);

try {
    await session.send("WebAuthn.enable");

    await session.send("WebAuthn.addVirtualAuthenticator", {
        options: {
            protocol: "ctap2",
            transport: "internal",
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true,
        },
    });

    await page.goto(`${registryUrl}/openapi`);

    const registration =
        (await user.client.webauthn.registrationOptions()) as unknown as RegistrationEnvelope;

    const registrationResponse = await page.evaluate(async (optionsValue) => {
        const decode = (value: string): ArrayBuffer => {
            const normalized = value
                .replaceAll("-", "+")
                .replaceAll("_", "/")
                .padEnd(Math.ceil(value.length / 4) * 4, "=");

            const bytes = Uint8Array.from(atob(normalized), (character) => {
                return character.charCodeAt(0);
            });

            return bytes.buffer;
        };

        const encode = (value: ArrayBuffer): string => {
            return btoa(String.fromCharCode(...new Uint8Array(value)))
                .replaceAll("+", "-")
                .replaceAll("/", "_")
                .replaceAll("=", "");
        };

        const options =
            optionsValue as unknown as PublicKeyCredentialCreationOptionsJSON;

        const { challenge, user, excludeCredentials, ...registrationOptions } =
            options;

        const credential = (await navigator.credentials.create({
            publicKey: {
                ...registrationOptions,
                challenge: decode(challenge),
                user: {
                    ...user,
                    id: decode(user.id),
                },
                ...(excludeCredentials === undefined
                    ? {}
                    : {
                          excludeCredentials: excludeCredentials.map(
                              (entry) => {
                                  return {
                                      ...entry,
                                      id: decode(entry.id),
                                  };
                              },
                          ),
                      }),
            },
        })) as PublicKeyCredential | null;

        if (credential === null) {
            throw new Error(
                "Virtual authenticator did not create a credential",
            );
        }

        const response =
            credential.response as AuthenticatorAttestationResponse;

        return {
            id: credential.id,
            rawId: encode(credential.rawId),
            type: "public-key" as const,
            response: {
                clientDataJSON: encode(response.clientDataJSON),
                attestationObject: encode(response.attestationObject),
                transports: response.getTransports?.() ?? [],
            },
            clientExtensionResults: credential.getClientExtensionResults(),
            authenticatorAttachment: credential.authenticatorAttachment,
        };
    }, registration.options);

    const credential = await user.client.webauthn.verifyRegistration({
        challengeId: registration.challengeId,
        name: "Virtual platform passkey",
        response: registrationResponse,
    });

    assert(
        credential.id !== undefined,
        "Passkey registration did not return an ID",
    );

    const authentication = (await user.client.webauthn.authenticationOptions(
        user.username,
    )) as unknown as AuthenticationEnvelope;

    const authenticationResponse = await page.evaluate(async (optionsValue) => {
        const decode = (value: string): ArrayBuffer => {
            const normalized = value
                .replaceAll("-", "+")
                .replaceAll("_", "/")
                .padEnd(Math.ceil(value.length / 4) * 4, "=");

            return Uint8Array.from(atob(normalized), (character) => {
                return character.charCodeAt(0);
            }).buffer;
        };

        const encode = (value: ArrayBuffer): string => {
            return btoa(String.fromCharCode(...new Uint8Array(value)))
                .replaceAll("+", "-")
                .replaceAll("/", "_")
                .replaceAll("=", "");
        };

        const options =
            optionsValue as unknown as PublicKeyCredentialRequestOptionsJSON;

        const { challenge, allowCredentials, ...authenticationOptions } =
            options;

        const credential = (await navigator.credentials.get({
            publicKey: {
                ...authenticationOptions,
                challenge: decode(challenge),
                ...(allowCredentials === undefined
                    ? {}
                    : {
                          allowCredentials: allowCredentials.map((entry) => {
                              return {
                                  ...entry,
                                  id: decode(entry.id),
                              };
                          }),
                      }),
            },
        })) as PublicKeyCredential | null;

        if (credential === null) {
            throw new Error(
                "Virtual authenticator did not return an assertion",
            );
        }

        const response = credential.response as AuthenticatorAssertionResponse;

        return {
            id: credential.id,
            rawId: encode(credential.rawId),
            type: "public-key" as const,
            response: {
                clientDataJSON: encode(response.clientDataJSON),
                authenticatorData: encode(response.authenticatorData),
                signature: encode(response.signature),
                userHandle:
                    response.userHandle === null
                        ? null
                        : encode(response.userHandle),
            },
            clientExtensionResults: credential.getClientExtensionResults(),
            authenticatorAttachment: credential.authenticatorAttachment,
        };
    }, authentication.options);

    const authenticated = await user.client.webauthn.verifyAuthentication({
        challengeId: authentication.challengeId,
        response: authenticationResponse,
    });

    const passkeyClient = new RegistryClient({
        baseUrl: registryUrl,
        token: authenticated.token,
    });

    assert(
        (await passkeyClient.whoami()).username === user.username,
        "Passkey token did not authenticate the expected user",
    );

    try {
        await user.client.webauthn.verifyAuthentication({
            challengeId: authentication.challengeId,
            response: authenticationResponse,
        });

        throw new Error("Reused WebAuthn challenge was accepted");
    } catch (err) {
        assert(
            err instanceof RegistryError && err.status === 400,
            "Reused WebAuthn challenge did not produce the expected failure",
        );
    }

    await user.client.webauthn.remove(credential.id);

    assert(
        (await user.client.webauthn.list()).items.length === 0,
        "Removed passkey remained visible",
    );

    console.info("Virtual WebAuthn registration and authentication passed.");
} finally {
    await session.send("WebAuthn.disable").catch(() => undefined);

    await browser.close();
}

interface PublicKeyCredentialCreationOptionsJSON
    extends Omit<
        PublicKeyCredentialCreationOptions,
        "challenge" | "user" | "excludeCredentials"
    > {
    challenge: string;
    user: Omit<PublicKeyCredentialUserEntity, "id"> & { id: string };
    excludeCredentials?: Array<
        Omit<PublicKeyCredentialDescriptor, "id"> & { id: string }
    >;
}

interface PublicKeyCredentialRequestOptionsJSON
    extends Omit<
        PublicKeyCredentialRequestOptions,
        "challenge" | "allowCredentials"
    > {
    challenge: string;
    allowCredentials?: Array<
        Omit<PublicKeyCredentialDescriptor, "id"> & { id: string }
    >;
}
