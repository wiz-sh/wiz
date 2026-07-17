import { SQL } from "bun";
import { type BunSQLDatabase, drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema.ts";

export type RegistryDatabase = BunSQLDatabase<typeof schema> & {
    $client: SQL;
};

/** Creates the typed Drizzle database without connecting until the first query. */
export function createDatabase(databaseUrl: string): RegistryDatabase {
    const client = new SQL(databaseUrl, {
        max: 10,
        idleTimeout: 30,
        connectionTimeout: 10,
    });

    return drizzle({
        client,
        schema,
    });
}
