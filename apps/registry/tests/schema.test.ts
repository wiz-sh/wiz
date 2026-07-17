import { expect, test } from "bun:test";
import { getTableName, isTable } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import * as schema from "../src/database/schema.ts";

test("the Drizzle schema exports every registry table", () => {
    const tableNames: string[] = [];

    for (const value of Object.values(schema)) {
        if (isTable(value)) {
            tableNames.push(getTableName(value));
        }
    }

    tableNames.sort();

    expect(tableNames).toHaveLength(41);

    expect(tableNames).toContain("users");

    expect(tableNames).toContain("packages");

    expect(tableNames).toContain("publish_transactions");

    expect(tableNames).toContain("jobs");
});

test("all generated SQL is registered in the Drizzle migration journal", () => {
    const migrations = readMigrationFiles({
        migrationsFolder: new URL("../migrations", import.meta.url).pathname,
    });

    expect(migrations).toHaveLength(3);

    expect(migrations[0]?.sql.join("\n")).toContain('CREATE TABLE "users"');

    expect(migrations[1]?.sql.join("\n")).toContain('ALTER TABLE "webhooks"');

    expect(migrations[2]?.sql.join("\n")).toContain(
        'ADD COLUMN "quarantined_at"',
    );

    for (const migration of migrations) {
        expect(migration.hash).toMatch(/^[a-f0-9]{64}$/);
    }
});
