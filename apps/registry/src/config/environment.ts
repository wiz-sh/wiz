import { resolve } from "node:path";
import type { RegistryServerConfig } from "./types.ts";

function required(environment: NodeJS.ProcessEnv, name: string): string {
    const value = environment[name];

    if (value === undefined || value.length === 0) {
        throw new Error(`Missing registry environment variable: ${name}`);
    }

    return value;
}

function secret(environment: NodeJS.ProcessEnv, name: string): string {
    const value = required(environment, name);

    if (value.length < 32) {
        throw new Error(`${name} must contain at least 32 characters`);
    }

    return value;
}

function integer(value: string | undefined, fallback: number): number {
    const parsed = value === undefined ? fallback : Number(value);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
        throw new Error(`Invalid TCP port: ${value}`);
    }

    return parsed;
}

function positiveInteger(
    value: string | undefined,
    fallback: number,
    name: string,
): number {
    const parsed = value === undefined ? fallback : Number(value);

    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new Error(`Invalid positive integer for ${name}: ${value}`);
    }

    return parsed;
}

function optional(value: string | undefined): string | undefined {
    return value === undefined || value.trim() === "" ? undefined : value;
}

function boolean(
    value: string | undefined,
    fallback: boolean,
    name: string,
): boolean {
    if (value === undefined) {
        return fallback;
    }

    if (value === "true") {
        return true;
    }

    if (value === "false") {
        return false;
    }

    throw new Error(`${name} must be either true or false`);
}

function commaSeparated(value: string | undefined): readonly string[] {
    if (value === undefined || value.trim() === "") {
        return [];
    }

    return value
        .split(",")
        .map((entry) => entry.trim().replace(/\/$/, ""))
        .filter((entry) => entry.length > 0);
}

/** Loads and validates every deployment-sensitive registry setting. */
export function loadRegistryConfig(
    environment: NodeJS.ProcessEnv = process.env,
): RegistryServerConfig {
    const storageDriver = environment.STORAGE_DRIVER ?? "filesystem";

    if (storageDriver !== "filesystem" && storageDriver !== "s3") {
        throw new Error(`Unsupported STORAGE_DRIVER: ${storageDriver}`);
    }

    const storage: RegistryServerConfig["storage"] =
        storageDriver === "filesystem"
            ? {
                  driver: "filesystem",
                  path: resolve(environment.STORAGE_PATH ?? "data/archives"),
              }
            : {
                  driver: "s3",
                  ...(environment.S3_ENDPOINT === undefined
                      ? {}
                      : { endpoint: environment.S3_ENDPOINT }),
                  region: environment.S3_REGION ?? "auto",
                  bucket: required(environment, "S3_BUCKET"),
                  accessKeyId: required(environment, "S3_ACCESS_KEY_ID"),
                  secretAccessKey: required(
                      environment,
                      "S3_SECRET_ACCESS_KEY",
                  ),
              };

    const logLevel = environment.LOG_LEVEL ?? "info";

    if (
        !(["debug", "info", "warn", "error"] as const).includes(
            logLevel as never,
        )
    ) {
        throw new Error(`Invalid LOG_LEVEL: ${logLevel}`);
    }

    const smtpUsername = optional(environment.SMTP_USERNAME);

    const smtpPassword = optional(environment.SMTP_PASSWORD);

    const logFormat = environment.LOG_FORMAT ?? "json";

    const telemetryEndpoint = optional(environment.OTEL_EXPORTER_OTLP_ENDPOINT);

    if (logFormat !== "json" && logFormat !== "pretty") {
        throw new Error(`Invalid LOG_FORMAT: ${logFormat}`);
    }

    return {
        host: environment.REGISTRY_HOST ?? "0.0.0.0",
        port: integer(environment.REGISTRY_PORT, 3000),
        publicUrl: required(environment, "REGISTRY_PUBLIC_URL").replace(
            /\/$/,
            "",
        ),
        databaseUrl: required(environment, "DATABASE_URL"),
        sessionSecret: secret(environment, "SESSION_SECRET"),
        tokenPepper: secret(environment, "TOKEN_PEPPER"),
        passwordPepper: secret(environment, "PASSWORD_PEPPER"),
        webauthn: {
            rpId: required(environment, "WEBAUTHN_RP_ID"),
            rpName: environment.WEBAUTHN_RP_NAME ?? "Wiz Registry",
            origin: required(environment, "WEBAUTHN_ORIGIN"),
        },
        smtp: {
            host: required(environment, "SMTP_HOST"),
            port: integer(environment.SMTP_PORT, 587),
            secure: environment.SMTP_SECURE === "true",
            requireTls: environment.SMTP_REQUIRE_TLS === "true",
            ...(smtpUsername === undefined ? {} : { username: smtpUsername }),
            ...(smtpPassword === undefined ? {} : { password: smtpPassword }),
            fromAddress: required(environment, "SMTP_FROM_ADDRESS"),
            fromName: environment.SMTP_FROM_NAME ?? "Wiz Registry",
        },
        storage,
        ...(environment.REDIS_URL === undefined
            ? {}
            : { redisUrl: environment.REDIS_URL }),
        rateLimits: {
            authentication: positiveInteger(
                environment.RATE_LIMIT_AUTHENTICATION,
                20,
                "RATE_LIMIT_AUTHENTICATION",
            ),
            api: positiveInteger(
                environment.RATE_LIMIT_API,
                120,
                "RATE_LIMIT_API",
            ),
            windowSeconds: positiveInteger(
                environment.RATE_LIMIT_WINDOW_SECONDS,
                60,
                "RATE_LIMIT_WINDOW_SECONDS",
            ),
        },
        logLevel: logLevel as RegistryServerConfig["logLevel"],
        logFormat,
        cors: {
            origins: commaSeparated(environment.CORS_ORIGINS),
            credentials: boolean(
                environment.CORS_ALLOW_CREDENTIALS,
                true,
                "CORS_ALLOW_CREDENTIALS",
            ),
            maxAgeSeconds: positiveInteger(
                environment.CORS_MAX_AGE_SECONDS,
                600,
                "CORS_MAX_AGE_SECONDS",
            ),
        },
        telemetry: {
            enabled: boolean(environment.OTEL_ENABLED, false, "OTEL_ENABLED"),
            serviceName: environment.OTEL_SERVICE_NAME ?? "wiz-registry",
            ...(telemetryEndpoint === undefined
                ? {}
                : { endpoint: telemetryEndpoint }),
            exportIntervalMilliseconds: positiveInteger(
                environment.OTEL_METRIC_EXPORT_INTERVAL,
                60_000,
                "OTEL_METRIC_EXPORT_INTERVAL",
            ),
        },
        administration: {
            usernames: commaSeparated(environment.REGISTRY_ADMIN_USERNAMES).map(
                (username) => username.toLowerCase(),
            ),
        },
    };
}
