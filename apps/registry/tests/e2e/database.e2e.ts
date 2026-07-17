import { afterAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { loadRegistryConfig } from "../../src/config/environment.ts";
import { createDatabase } from "../../src/database/client.ts";
import { migrateDatabase } from "../../src/database/migrate.ts";
import { idempotencyKeys, users } from "../../src/database/schema.ts";
import { RegistryMailer } from "../../src/email/client.ts";
import { createRegistryApplication } from "../../src/server.ts";
import { runMaintenance } from "../../src/worker.ts";

const databaseUrl = process.env.REGISTRY_DATABASE_TEST_URL;

if (databaseUrl === undefined) {
    throw new Error(
        "REGISTRY_DATABASE_TEST_URL is required for database E2E tests",
    );
}

const database = createDatabase(databaseUrl);

const config = loadRegistryConfig();

const mailer = new RegistryMailer(config.smtp);

afterAll(async () => {
    mailer.close();

    await database.$client.close();
});

test("Drizzle migrates and queries a real PostgreSQL database", async () => {
    await migrateDatabase(database);

    const username = `drizzle-${crypto.randomUUID()}`;

    const inserted = await database
        .insert(users)
        .values({
            username,
            usernameNormalized: username,
        })
        .returning({ id: users.id });

    expect(inserted[0]?.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const selected = await database
        .select({ username: users.username })
        .from(users)
        .where(eq(users.usernameNormalized, username));

    expect(selected).toEqual([{ username }]);

    await database.delete(users).where(eq(users.usernameNormalized, username));
});

test("the registry health endpoint reports the migrated Drizzle database", async () => {
    const application = createRegistryApplication(config, {
        database,
        mailer,
    });

    const response = await application.handle(
        new Request("http://localhost/health"),
    );

    expect(response.status).toBe(200);

    expect(await response.json()).toEqual({
        status: "ok",
        database: "connected",
    });
});

test("the maintenance worker deletes expired state through Drizzle", async () => {
    const principalKey = `test:${crypto.randomUUID()}`;

    await database.insert(idempotencyKeys).values({
        principalKey,
        idempotencyKey: "request",
        requestHash: "hash",
        expiresAt: new Date(Date.now() - 60_000),
    });

    const result = await runMaintenance(database);

    expect(result.idempotencyKeys).toBeGreaterThanOrEqual(1);

    const remaining = await database
        .select({ principalKey: idempotencyKeys.principalKey })
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.principalKey, principalKey));

    expect(remaining).toEqual([]);
});
