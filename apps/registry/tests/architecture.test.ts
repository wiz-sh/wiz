import { expect, test } from "bun:test";
import manifest from "../package.json";

test("registry PostgreSQL access is owned by Drizzle", async () => {
    const client = await Bun.file(
        new URL("../src/database/client.ts", import.meta.url),
    ).text();

    const migrator = await Bun.file(
        new URL("../src/database/migrate.ts", import.meta.url),
    ).text();

    expect(client).toContain('from "drizzle-orm/bun-sql"');

    expect(client).toContain("return drizzle({");

    expect(migrator).toContain('from "drizzle-orm/bun-sql/migrator"');

    expect(manifest.dependencies).toHaveProperty("drizzle-orm");

    expect(manifest.dependencies).not.toHaveProperty("pg");

    expect(manifest.dependencies).not.toHaveProperty("postgres");
});
