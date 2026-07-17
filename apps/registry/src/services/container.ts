import type { RegistryServerConfig } from "../config/types.ts";
import type { RegistryDatabase } from "../database/client.ts";
import type { RegistryMailer } from "../email/client.ts";
import {
    createRegistryLogger,
    type RegistryLogger,
} from "../observability/logger.ts";
import { FilesystemArchiveStorage } from "../storage/filesystem.ts";
import { S3ArchiveStorage } from "../storage/s3.ts";
import type { ArchiveStorage } from "../storage/types.ts";
import { AccountService } from "./account-service.ts";
import { AuthService } from "./auth-service.ts";
import { ModerationService } from "./moderation-service.ts";
import { OrganizationService } from "./organization-service.ts";
import { PackageManagementService } from "./package-management-service.ts";
import { PackageService } from "./package-service.ts";
import { RateLimitService } from "./rate-limit-service.ts";
import { WebAuthnService } from "./webauthn-service.ts";
import { WebhookService } from "./webhook-service.ts";

export interface RegistryServices {
    database: RegistryDatabase;
    mailer: RegistryMailer;
    storage: ArchiveStorage;
    auth: AuthService;
    packages: PackageService;
    organizations: OrganizationService;
    webauthn: WebAuthnService;
    packageManagement: PackageManagementService;
    rateLimits: RateLimitService;
    accounts: AccountService;
    logger: RegistryLogger;
    webhooks: WebhookService;
    moderation: ModerationService;
}

export function createRegistryServices(
    config: RegistryServerConfig,
    database: RegistryDatabase,
    mailer: RegistryMailer,
): RegistryServices {
    const storage: ArchiveStorage =
        config.storage.driver === "filesystem"
            ? new FilesystemArchiveStorage(config.storage.path)
            : new S3ArchiveStorage(config.storage);

    const auth = new AuthService(database, config, mailer);

    return {
        database,
        mailer,
        storage,
        auth,
        packages: new PackageService(database, storage, config),
        organizations: new OrganizationService(database, config),
        webauthn: new WebAuthnService(database, config, auth),
        packageManagement: new PackageManagementService(database),
        rateLimits: new RateLimitService(config.redisUrl),
        accounts: new AccountService(database, config, auth),
        logger: createRegistryLogger(config),
        webhooks: new WebhookService(database, config),
        moderation: new ModerationService(database, config),
    };
}
