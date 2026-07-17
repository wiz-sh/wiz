import { ImapFlow } from "imapflow";
import { createRegistryApplication } from "../apps/registry/src/app.ts";
import type { RegistryServerConfig } from "../apps/registry/src/config/types.ts";
import { createDatabase } from "../apps/registry/src/database/client.ts";
import { migrateDatabase } from "../apps/registry/src/database/migrate.ts";
import { RegistryMailer } from "../apps/registry/src/email/client.ts";

const repositoryRoot = `${import.meta.dir}/..`;

async function compose(argumentsList: readonly string[]): Promise<void> {
    const command = [
        "docker",
        "compose",
        "--project-name",
        "wiz-smtp-e2e",
        "--file",
        "docker-compose.dev.yml",
        ...argumentsList,
    ];

    const processHandle = Bun.spawn(command, {
        cwd: repositoryRoot,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });

    const exitCode = await processHandle.exited;

    if (exitCode !== 0) {
        throw new Error(`Docker Compose exited with status ${exitCode}`);
    }
}

function parseEnvironment(source: string): Record<string, string> {
    const result: Record<string, string> = {};

    for (const line of source.split(/\r?\n/)) {
        const trimmed = line.trim();

        if (trimmed === "" || trimmed.startsWith("#")) {
            continue;
        }

        const separator = trimmed.indexOf("=");

        if (separator > 0) {
            result[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
        }
    }

    return result;
}

function required(environment: Record<string, string>, name: string): string {
    const value = environment[name];

    if (value === undefined || value === "") {
        throw new Error(`Missing ${name} in .env.smtp-e2e.local`);
    }

    return value;
}

async function verificationToken(
    client: ImapFlow,
    recipient: string,
    startedAt: Date,
): Promise<string> {
    const lock = await client.getMailboxLock("INBOX");

    try {
        for (let attempt = 0; attempt < 30; attempt += 1) {
            const messages = await client.search({
                since: new Date(startedAt.getTime() - 60_000),
            });

            if (messages === false) {
                await Bun.sleep(2_000);

                continue;
            }

            for (const sequence of [...messages].reverse()) {
                const message = await client.fetchOne(sequence, {
                    envelope: true,
                    source: true,
                });

                if (message === false) {
                    continue;
                }

                const addressed = message.envelope?.to?.some((address) => {
                    return (
                        address.address?.toLowerCase() ===
                        recipient.toLowerCase()
                    );
                });

                if (
                    addressed !== true ||
                    message.envelope?.subject !==
                        "Verify your Wiz Registry email"
                ) {
                    continue;
                }

                const source = (message.source?.toString("utf8") ?? "")
                    .replace(/=\r?\n/g, "")
                    .replace(
                        /=([0-9A-F]{2})/gi,
                        (_match, hexadecimal: string) => {
                            return String.fromCharCode(
                                Number.parseInt(hexadecimal, 16),
                            );
                        },
                    );

                const token = /[?&]token=([^\s"<&]+)/.exec(source)?.[1];

                if (token !== undefined) {
                    return decodeURIComponent(token);
                }
            }

            await Bun.sleep(2_000);
        }
    } finally {
        lock.release();
    }

    throw new Error(
        "Verification email did not arrive in the configured mailbox",
    );
}

async function main(): Promise<void> {
    const localFile = Bun.file(`${import.meta.dir}/../.env.smtp-e2e.local`);

    if (!(await localFile.exists())) {
        console.info(
            "Real SMTP E2E is disabled; create ignored .env.smtp-e2e.local to enable it.",
        );

        return;
    }

    const localEnvironment = parseEnvironment(await localFile.text());

    const environment = {
        ...localEnvironment,
        ...Object.fromEntries(
            Object.entries(process.env).filter(
                (entry): entry is [string, string] => {
                    return entry[1] !== undefined;
                },
            ),
        ),
    };

    if (environment.WIZ_SMTP_E2E_ENABLED !== "true") {
        console.info("Real SMTP E2E is disabled by WIZ_SMTP_E2E_ENABLED.");

        return;
    }

    const port = 53_101;

    const config: RegistryServerConfig = {
        host: "127.0.0.1",
        port,
        publicUrl: `http://127.0.0.1:${port}`,
        databaseUrl: required(environment, "DATABASE_URL"),
        sessionSecret: "smtp-e2e-session-secret-at-least-32-characters",
        tokenPepper: "smtp-e2e-token-pepper-at-least-32-characters",
        passwordPepper: "smtp-e2e-password-pepper-at-least-32-characters",
        webauthn: {
            rpId: "localhost",
            rpName: "Wiz Registry SMTP E2E",
            origin: `http://localhost:${port}`,
        },
        smtp: {
            host: required(environment, "WIZ_SMTP_HOST"),
            port: Number(required(environment, "WIZ_SMTP_PORT")),
            secure: environment.WIZ_SMTP_USE_TLS === "true",
            requireTls: environment.WIZ_SMTP_USE_STARTTLS === "true",
            username: required(environment, "WIZ_SMTP_USERNAME"),
            password: required(environment, "WIZ_SMTP_PASSWORD"),
            fromAddress: required(environment, "WIZ_SMTP_FROM"),
            fromName: "Wiz Registry SMTP E2E",
        },
        storage: {
            driver: "filesystem",
            path: `${import.meta.dir}/../apps/registry/data/smtp-e2e`,
        },
        rateLimits: {
            authentication: 100,
            api: 100,
            windowSeconds: 60,
        },
        logLevel: "error",
        logFormat: "json",
        cors: {
            origins: [],
            credentials: false,
            maxAgeSeconds: 600,
        },
        telemetry: {
            enabled: false,
            serviceName: "wiz-registry-smtp-e2e",
            exportIntervalMilliseconds: 60_000,
        },
        administration: {
            usernames: [],
        },
    };

    const database = createDatabase(config.databaseUrl);

    const mailer = new RegistryMailer(config.smtp);

    const mailbox = new ImapFlow({
        host: required(environment, "WIZ_MAILBOX_HOST"),
        port: Number(required(environment, "WIZ_MAILBOX_PORT")),
        secure: environment.WIZ_MAILBOX_USE_TLS === "true",
        auth: {
            user: required(environment, "WIZ_MAILBOX_USERNAME"),
            pass: required(environment, "WIZ_MAILBOX_PASSWORD"),
        },
        logger: false,
    });

    let application: ReturnType<typeof createRegistryApplication> | undefined;

    let infrastructureStarted = false;

    try {
        // The opt-in test owns an isolated PostgreSQL lifecycle so it remains autonomous.
        infrastructureStarted = true;

        await compose(["up", "--detach", "--wait", "postgres"]);

        await migrateDatabase(database);

        await mailer.verify();

        await mailbox.connect();

        application = createRegistryApplication(config, { database, mailer });

        application.listen({ hostname: config.host, port: config.port });

        const mailboxAddress = required(environment, "WIZ_MAILBOX_USERNAME");

        const at = mailboxAddress.lastIndexOf("@");

        if (at < 1) {
            throw new Error("WIZ_MAILBOX_USERNAME must be an email address");
        }

        const recipient = `${mailboxAddress.slice(0, at)}+wiz-${crypto.randomUUID().slice(0, 8)}${mailboxAddress.slice(at)}`;

        const username = `smtp-${crypto.randomUUID().slice(0, 12)}`;

        const startedAt = new Date();

        const signup = await fetch(`${config.publicUrl}/v1/auth/signup`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                username,
                email: recipient,
                password: `SMTP-${crypto.randomUUID()}-Password!`,
            }),
        });

        if (signup.status !== 201) {
            throw new Error(
                `SMTP E2E signup failed with status ${signup.status}`,
            );
        }

        const token = await verificationToken(mailbox, recipient, startedAt);

        const verified = await fetch(
            `${config.publicUrl}/v1/auth/email/verify`,
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ token }),
            },
        );

        if (!verified.ok) {
            throw new Error(
                `SMTP E2E verification failed with status ${verified.status}`,
            );
        }

        console.info("Real SMTP delivery and mailbox verification passed.");
    } finally {
        application?.stop();

        await mailbox.logout().catch(() => undefined);

        mailer.close();

        await database.$client.close();

        if (infrastructureStarted) {
            try {
                await compose(["down", "--volumes", "--remove-orphans"]);
            } catch (err) {
                console.error(
                    err instanceof Error
                        ? err.message
                        : "Failed to clean up SMTP test infrastructure",
                );
            }
        }
    }
}

await main();
