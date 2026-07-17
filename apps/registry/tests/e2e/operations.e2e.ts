import { afterAll, expect, test } from "bun:test";
import { RegistryClient } from "@wiz/registry-client";
import { loadRegistryConfig } from "../../src/config/environment.ts";
import { createDatabase } from "../../src/database/client.ts";
import { webhookDeliveries, webhookEvents } from "../../src/database/schema.ts";
import { webhookSignature } from "../../src/services/webhook-service.ts";
import {
    processWebhookDeliveries,
    type WebhookFetch,
} from "../../src/worker.ts";
import {
    createVerifiedUser,
    emailToken,
    registryUrl,
    unique,
} from "./helpers.e2e.ts";

const databaseUrl = process.env.REGISTRY_DATABASE_TEST_URL;

if (databaseUrl === undefined) {
    throw new Error(
        "REGISTRY_DATABASE_TEST_URL is required for operations E2E tests",
    );
}

const database = createDatabase(databaseUrl);

const config = loadRegistryConfig();

afterAll(async () => {
    await database.$client.close();
});

async function createAdministrator(): Promise<RegistryClient> {
    const username = "admin-e2e";

    const email = `${unique("admin")}@registry.test.localhost`;

    const password = `Correct-Horse-${crypto.randomUUID()}!`;

    const client = new RegistryClient({ baseUrl: registryUrl });

    await client.users.signup({ username, email, password });

    await client.users.verifyEmail(
        await emailToken(email, "Verify your Wiz Registry email"),
    );

    const login = await client.users.login({ identifier: username, password });

    if (login.token === undefined) {
        throw new Error("Administrator login did not return a token");
    }

    return new RegistryClient({
        baseUrl: registryUrl,
        token: login.token,
    });
}

test("webhook deliveries are signed, bounded, and visible through the SDK", async () => {
    const owner = await createVerifiedUser("webhook");

    const packageName = `@${owner.username}/${unique("events")}`;

    await owner.client.packages.create({
        name: packageName,
        visibility: "public",
    });

    const webhook = await owner.client.webhooks.create(
        { packageName },
        {
            url: "https://webhook.example.com/events",
            events: ["package.published"],
        },
    );

    expect(webhook.secret).toStartWith("wiz_whsec_");

    const [event] = await database
        .insert(webhookEvents)
        .values({
            eventType: "package.published",
            payload: { package: packageName, version: "1.0.0" },
        })
        .returning();

    if (event === undefined) {
        throw new Error("Webhook event fixture was not inserted");
    }

    const future = new Date("2031-01-01T00:00:00.000Z");

    await database.insert(webhookDeliveries).values({
        webhookId: webhook.id,
        eventId: event.id,
        nextAttemptAt: future,
    });

    let requestBody = "";

    let requestHeaders = new Headers();

    const fetcher: WebhookFetch = async (_input, init) => {
        requestBody = String(init?.body ?? "");
        requestHeaders = new Headers(init?.headers);

        return new Response("accepted", { status: 202 });
    };

    const delivered = await processWebhookDeliveries(
        database,
        config,
        fetcher,
        new Date("2031-01-01T00:00:01.000Z"),
        async () => {},
    );

    expect(delivered).toBe(1);

    const timestamp = requestHeaders.get("x-wiz-timestamp");

    expect(timestamp).not.toBeNull();
    expect(requestHeaders.get("x-wiz-event-id")).toBe(event.id);
    expect(requestHeaders.get("x-wiz-signature")).toBe(
        webhookSignature(webhook.secret, timestamp ?? "", requestBody),
    );

    const deliveries = await owner.client.webhooks.deliveries(
        { packageName },
        webhook.id,
    );

    expect(deliveries.items[0]?.status).toBe("delivered");
    expect(deliveries.items[0]?.responseExcerpt).toBe("accepted");
});

test("reports require administrators and quarantine packages without disclosure", async () => {
    const owner = await createVerifiedUser("reporter");

    const packageName = `@${owner.username}/${unique("moderation")}`;

    await owner.client.packages.create({
        name: packageName,
        visibility: "public",
    });

    const report = await owner.client.administration.report({
        packageName,
        reason: "malware",
        details: "The package fixture represents a confirmed policy violation.",
    });

    await expect(owner.client.administration.reports()).rejects.toMatchObject({
        status: 404,
    });

    const administrator = await createAdministrator();

    expect(
        (await administrator.administration.reports("open")).items.some(
            (entry) => entry.id === report.id,
        ),
    ).toBeTrue();

    await administrator.administration.moderate(
        report.id,
        "quarantine",
        "Confirmed by the autonomous moderation fixture.",
    );

    await expect(owner.client.packages.get(packageName)).rejects.toMatchObject({
        code: "PACKAGE_NOT_FOUND",
        status: 404,
    });

    await administrator.administration.moderate(
        report.id,
        "restore",
        "Fixture cleanup restores the package.",
    );

    expect((await owner.client.packages.get(packageName)).name).toBe(
        packageName,
    );
});

test("search filters, paginates, and does not enumerate private packages", async () => {
    const owner = await createVerifiedUser("search");

    const marker = unique("discover").toLowerCase();

    const first = `@${owner.username}/${marker}-one`;

    const second = `@${owner.username}/${marker}-two`;

    const privateName = `@${owner.username}/${marker}-private`;

    for (const name of [first, second]) {
        await owner.client.packages.create({
            name,
            visibility: "public",
            description: `Search fixture ${marker} compiler`,
        });
    }

    await owner.client.packages.create({
        name: privateName,
        visibility: "private",
        description: `Search fixture ${marker} secret`,
    });

    const publicClient = new RegistryClient({ baseUrl: registryUrl });

    const page = await publicClient.search({
        query: marker,
        scope: `@${owner.username}`,
        owner: owner.username,
        keyword: "compiler",
        visibility: "public",
        sort: "name",
        limit: 1,
    });

    expect(page.items).toHaveLength(1);

    expect(page.nextCursor).toBeDefined();

    const cursor = page.nextCursor;

    if (cursor === undefined) {
        throw new Error("Expected a cursor for the second search page");
    }

    const next = await publicClient.search({
        query: marker,
        cursor,
        scope: `@${owner.username}`,
        visibility: "public",
        limit: 1,
    });

    expect(next.items).toHaveLength(1);

    expect(next.items[0]?.name).not.toBe(page.items[0]?.name);

    expect(
        (await publicClient.search({ query: marker, visibility: "private" }))
            .items,
    ).toEqual([]);

    expect(
        (
            await owner.client.search({
                query: marker,
                visibility: "private",
            })
        ).items.map((entry) => {
            return entry.name;
        }),
    ).toContain(privateName);
});
