import { join } from "node:path";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { loadRegistryConfig } from "../config/environment.ts";
import { createDatabase, type RegistryDatabase } from "./client.ts";

export async function migrateDatabase(
    database: RegistryDatabase,
    directory = join(import.meta.dir, "../../migrations"),
): Promise<void> {
    await migrate(database, {
        migrationsFolder: directory,
        migrationsSchema: "drizzle",
        migrationsTable: "registry_migrations",
    });
}

if (import.meta.main) {
    const config = loadRegistryConfig();

    const database = createDatabase(config.databaseUrl);

    await migrateDatabase(database);

    await database.$client.close();
}
