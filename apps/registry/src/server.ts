import { createRegistryApplication } from "./app.ts";
import { loadRegistryConfig } from "./config/environment.ts";
import { createDatabase } from "./database/client.ts";
import { RegistryMailer } from "./email/client.ts";
import { createRegistryServices } from "./services/container.ts";

export { createRegistryApplication } from "./app.ts";
export type { RegistryServices } from "./services/container.ts";

/** Starts the registry and closes database and SMTP resources on termination. */
export async function startRegistry(
    config = loadRegistryConfig(),
): Promise<void> {
    const database = createDatabase(config.databaseUrl);

    const mailer = new RegistryMailer(config.smtp);

    const services = createRegistryServices(config, database, mailer);

    const application = createRegistryApplication(config, services);

    application.listen({
        hostname: config.host,
        port: config.port,
    });

    services.logger.info("Wiz Registry started", {
        publicUrl: config.publicUrl,
        host: config.host,
        port: config.port,
    });

    const stop = async (): Promise<void> => {
        services.logger.info("Wiz Registry is shutting down");

        await application.stop();

        mailer.close();

        services.rateLimits.close();

        await database.$client.close();
    };

    process.once("SIGINT", stop);

    process.once("SIGTERM", stop);
}

if (import.meta.main) {
    await startRegistry();
}
