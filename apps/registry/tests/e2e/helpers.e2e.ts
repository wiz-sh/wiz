import { createHash } from "node:crypto";
import { RegistryClient } from "@wiz/registry-client";

export const registryUrl =
    process.env.WIZ_REGISTRY_E2E_URL ?? "http://localhost:53000";

export const mailpitUrl =
    process.env.WIZ_MAILPIT_URL ?? "http://localhost:58025";

export function unique(prefix: string): string {
    return `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
}

export async function emailToken(
    recipient: string,
    subject: string,
): Promise<string> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const response = await fetch(`${mailpitUrl}/api/v1/messages`);

        const data = (await response.json()) as {
            messages?: Array<{
                ID?: string;
                To?: Array<{ Address?: string }>;
                Subject?: string;
            }>;
        };

        const message = data.messages?.find((entry) => {
            return (
                entry.Subject === subject &&
                entry.To?.some((address) => {
                    return address.Address === recipient;
                }) === true
            );
        });

        if (message?.ID !== undefined) {
            const detail = (await fetch(
                `${mailpitUrl}/api/v1/message/${message.ID}`,
            ).then((result) => {
                return result.json();
            })) as { Text?: string; HTML?: string };

            const content = `${detail.Text ?? ""}\n${detail.HTML ?? ""}`;

            const token = /[?&]token=([^\s"<&]+)/.exec(content)?.[1];

            if (token !== undefined) {
                return decodeURIComponent(token);
            }
        }

        await Bun.sleep(100);
    }

    throw new Error(`Verification email did not arrive for ${recipient}`);
}

export function verificationToken(recipient: string): Promise<string> {
    return emailToken(recipient, "Verify your Wiz Registry email");
}

export async function createVerifiedUser(prefix: string) {
    const username = unique(prefix).toLowerCase();

    const email = `${username}@registry.test.localhost`;

    const password = `Correct-Horse-${crypto.randomUUID()}!`;

    const client = new RegistryClient({ baseUrl: registryUrl });

    await client.users.signup({ username, email, password });

    const token = await verificationToken(email);

    await client.users.verifyEmail(token);

    const login = await client.users.login({ identifier: username, password });

    if (login.token === undefined) {
        throw new Error("Verified user login did not return a token");
    }

    return {
        username,
        email,
        password,
        token: login.token,
        client: new RegistryClient({
            baseUrl: registryUrl,
            token: login.token,
        }),
    };
}

export async function packageArchive(name: string, version: string) {
    const manifest = {
        name,
        version,
        bin: { hello: "src/hello.sh" },
        scripts: {},
        dependencies: {},
    };

    const bytes = await new Bun.Archive(
        {
            "manifest.json": `${JSON.stringify(manifest, null, 4)}\n`,
            "src/hello.sh": "#!/usr/bin/env bash\nprintf 'registry works\\n'\n",
        },
        { compress: "gzip", level: 9 },
    ).bytes();

    return {
        bytes,
        integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    };
}
