import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.trim() === "") {
    throw new Error("DATABASE_URL is required for Drizzle Kit commands");
}

export default defineConfig({
    dialect: "postgresql",
    schema: "./src/database/schema.ts",
    out: "./migrations",
    dbCredentials: {
        url: databaseUrl,
    },
    migrations: {
        schema: "drizzle",
        table: "registry_migrations",
    },
    strict: true,
    verbose: true,
});
