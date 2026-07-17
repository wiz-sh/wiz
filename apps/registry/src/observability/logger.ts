import type { RegistryServerConfig } from "../config/types.ts";

export type LogLevel = RegistryServerConfig["logLevel"];

export interface LogEntry {
    level: LogLevel;
    message: string;
    requestId?: string;
    method?: string;
    route?: string;
    status?: number;
    durationMs?: number;
    principalId?: string;
    tokenId?: string;
    organizationId?: string;
    packageId?: string;
    clientVersion?: string;
    error?: unknown;
    [key: string]: unknown;
}

export type LogWriter = (line: string) => void;

const levels: Readonly<Record<LogLevel, number>> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

const sensitiveKey =
    /authorization|cookie|password|token|secret|totp|recovery|assertion|signature|credential/i;

function redactText(value: string, secrets: readonly string[]): string {
    let result = value;

    for (const secret of secrets) {
        if (secret.length >= 6) {
            result = result.replaceAll(secret, "[REDACTED]");
        }
    }

    return result;
}

/** Redacts nested structured data before it can reach a log transport. */
export function redactLogValue(
    value: unknown,
    secrets: readonly string[] = [],
): unknown {
    if (typeof value === "string") {
        return redactText(value, secrets);
    }

    if (Array.isArray(value)) {
        return value.map((entry) => redactLogValue(entry, secrets));
    }

    if (value instanceof Error) {
        return {
            name: value.name,
            message: redactText(value.message, secrets),
            ...(value.stack === undefined
                ? {}
                : { stack: redactText(value.stack, secrets) }),
        };
    }

    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => {
                return [
                    key,
                    sensitiveKey.test(key)
                        ? "[REDACTED]"
                        : redactLogValue(entry, secrets),
                ];
            }),
        );
    }

    return value;
}

/** Writes stable structured logs while keeping credentials out of every sink. */
export class RegistryLogger {
    readonly #level: LogLevel;

    readonly #format: RegistryServerConfig["logFormat"];

    readonly #writer: LogWriter;

    readonly #secrets: readonly string[];

    constructor(
        config: Pick<RegistryServerConfig, "logLevel" | "logFormat">,
        options: {
            writer?: LogWriter;
            secrets?: readonly string[];
        } = {},
    ) {
        this.#level = config.logLevel;
        this.#format = config.logFormat;
        this.#writer = options.writer ?? console.log;
        this.#secrets = options.secrets ?? [];
    }

    debug(
        message: string,
        attributes: Omit<LogEntry, "level" | "message"> = {},
    ): void {
        this.write({ level: "debug", message, ...attributes });
    }

    info(
        message: string,
        attributes: Omit<LogEntry, "level" | "message"> = {},
    ): void {
        this.write({ level: "info", message, ...attributes });
    }

    warn(
        message: string,
        attributes: Omit<LogEntry, "level" | "message"> = {},
    ): void {
        this.write({ level: "warn", message, ...attributes });
    }

    error(
        message: string,
        attributes: Omit<LogEntry, "level" | "message"> = {},
    ): void {
        this.write({ level: "error", message, ...attributes });
    }

    logRequest(entry: LogEntry): void {
        this.write({ ...entry, message: "HTTP request completed" });
    }

    private write(entry: LogEntry): void {
        if (levels[entry.level] < levels[this.#level]) {
            return;
        }

        const redacted = redactLogValue(
            {
                timestamp: new Date().toISOString(),
                ...entry,
            },
            this.#secrets,
        ) as Record<string, unknown>;

        if (this.#format === "pretty") {
            const context = Object.entries(redacted)
                .filter(([key]) => {
                    return !["timestamp", "level", "message"].includes(key);
                })
                .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
                .join(" ");

            this.#writer(
                `${redacted.timestamp} ${String(redacted.level).toUpperCase()} ${redacted.message}${context.length === 0 ? "" : ` ${context}`}`,
            );

            return;
        }

        this.#writer(JSON.stringify(redacted));
    }
}

export function createRegistryLogger(
    config: RegistryServerConfig,
): RegistryLogger {
    return new RegistryLogger(config, {
        secrets: [
            config.sessionSecret,
            config.tokenPepper,
            config.passwordPepper,
            config.smtp.password ?? "",
            config.storage.driver === "s3"
                ? config.storage.secretAccessKey
                : "",
        ],
    });
}
