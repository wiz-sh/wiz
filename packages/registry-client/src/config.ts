import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { RegistryError } from "./errors.ts";
import type {
    ProjectRegistryConfig,
    RegistryEntry,
    RegistrySelection,
    UserRegistryConfig,
} from "./types.ts";

export const OFFICIAL_REGISTRY_URL = "https://registry.wiz.sh";

export function userConfigPath(environment = process.env): string {
    return resolve(
        environment.WIZ_CONFIG ??
            resolve(environment.HOME ?? homedir(), ".config/wiz.json"),
    );
}

function isLoopback(hostname: string): boolean {
    return (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname.endsWith(".localhost")
    );
}

/** Normalizes registry bases and rejects credential-bearing or insecure remote URLs. */
export function normalizeRegistryUrl(
    value: string,
    allowInsecure = false,
): string {
    let url: URL;

    try {
        url = new URL(value);
    } catch {
        throw new RegistryError("Registry URL must be absolute", {
            code: "REGISTRY_URL_INVALID",
            status: 400,
        });
    }

    if (url.username !== "" || url.password !== "") {
        throw new RegistryError("Registry URLs cannot contain credentials", {
            code: "REGISTRY_URL_INVALID",
            status: 400,
        });
    }

    if (
        url.protocol !== "https:" &&
        !(
            url.protocol === "http:" &&
            (allowInsecure || isLoopback(url.hostname))
        )
    ) {
        throw new RegistryError("Remote registries must use HTTPS", {
            code: "REGISTRY_URL_INSECURE",
            status: 400,
        });
    }

    if (url.search !== "" || url.hash !== "") {
        throw new RegistryError(
            "Registry URLs cannot contain query or fragment data",
            {
                code: "REGISTRY_URL_INVALID",
                status: 400,
            },
        );
    }

    return url.toString().replace(/\/$/, "");
}

export function defaultUserRegistryConfig(): UserRegistryConfig {
    return {
        defaultRegistry: "official",
        registries: {
            official: {
                url: OFFICIAL_REGISTRY_URL,
            },
        },
        scopes: {},
    };
}

function parseEntry(name: string, value: unknown): RegistryEntry {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new RegistryError(`Registry ${name} must be an object`, {
            code: "REGISTRY_CONFIG_INVALID",
            status: 400,
        });
    }

    const entry = value as Record<string, unknown>;

    if (typeof entry.url !== "string") {
        throw new RegistryError(`Registry ${name} requires a URL`, {
            code: "REGISTRY_CONFIG_INVALID",
            status: 400,
        });
    }

    const allowInsecure = entry.allowInsecure === true;

    return {
        url: normalizeRegistryUrl(entry.url, allowInsecure),
        ...(typeof entry.token === "string" ? { token: entry.token } : {}),
        ...(allowInsecure ? { allowInsecure: true } : {}),
    };
}

export function validateUserRegistryConfig(value: unknown): UserRegistryConfig {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new RegistryError("Wiz user configuration must be an object", {
            code: "REGISTRY_CONFIG_INVALID",
            status: 400,
        });
    }

    const root = value as Record<string, unknown>;

    const defaultRegistry =
        typeof root.defaultRegistry === "string"
            ? root.defaultRegistry
            : "official";

    const rawRegistries =
        typeof root.registries === "object" &&
        root.registries !== null &&
        !Array.isArray(root.registries)
            ? (root.registries as Record<string, unknown>)
            : {};

    const registries: Record<string, RegistryEntry> = {};

    for (const [name, entry] of Object.entries(rawRegistries)) {
        registries[name] = parseEntry(name, entry);
    }

    if (registries.official === undefined) {
        registries.official = { url: OFFICIAL_REGISTRY_URL };
    }

    if (registries[defaultRegistry] === undefined) {
        throw new RegistryError(
            `Default registry is not configured: ${defaultRegistry}`,
            {
                code: "REGISTRY_CONFIG_INVALID",
                status: 400,
            },
        );
    }

    const scopes: Record<string, { registry: string }> = {};

    if (
        typeof root.scopes === "object" &&
        root.scopes !== null &&
        !Array.isArray(root.scopes)
    ) {
        for (const [scope, raw] of Object.entries(root.scopes)) {
            if (!scope.startsWith("@")) {
                throw new RegistryError(`Invalid registry scope: ${scope}`, {
                    code: "REGISTRY_CONFIG_INVALID",
                    status: 400,
                });
            }

            const registry =
                typeof raw === "object" &&
                raw !== null &&
                !Array.isArray(raw) &&
                typeof (raw as Record<string, unknown>).registry === "string"
                    ? String((raw as Record<string, unknown>).registry)
                    : undefined;

            if (registry === undefined || registries[registry] === undefined) {
                throw new RegistryError(`Unknown registry for scope ${scope}`, {
                    code: "REGISTRY_CONFIG_INVALID",
                    status: 400,
                });
            }

            scopes[scope.toLowerCase()] = { registry };
        }
    }

    return { defaultRegistry, registries, scopes };
}

export async function loadUserRegistryConfig(
    path = userConfigPath(),
): Promise<UserRegistryConfig> {
    try {
        return validateUserRegistryConfig(
            JSON.parse(await readFile(path, "utf8")),
        );
    } catch (err) {
        if (err instanceof Error && "code" in err && err.code === "ENOENT") {
            return defaultUserRegistryConfig();
        }

        if (err instanceof RegistryError) {
            throw err;
        }

        throw new RegistryError(`Cannot read Wiz user configuration: ${path}`, {
            code: "REGISTRY_CONFIG_INVALID",
            status: 400,
            cause: err,
        });
    }
}

/** Atomically saves user configuration with owner-only permissions where supported. */
export async function saveUserRegistryConfig(
    config: UserRegistryConfig,
    path = userConfigPath(),
): Promise<void> {
    const validated = validateUserRegistryConfig(config);

    await mkdir(dirname(path), { recursive: true, mode: 0o700 });

    const temporary = `${path}.tmp-${crypto.randomUUID()}`;

    await writeFile(temporary, `${JSON.stringify(validated, null, 4)}\n`, {
        mode: 0o600,
    });

    await rename(temporary, path);

    await chmod(path, 0o600).catch(() => {
        // Some filesystems do not expose POSIX permissions; atomic replacement still applies.
    });
}

function packageScope(packageName: string): string | undefined {
    return packageName.startsWith("@")
        ? packageName.slice(0, packageName.indexOf("/"))
        : undefined;
}

/** Applies CLI, environment, project, user, and official-registry precedence. */
export function selectRegistry(
    packageName: string,
    user: UserRegistryConfig,
    options: {
        registry?: string;
        token?: string;
        project?: ProjectRegistryConfig;
        environment?: NodeJS.ProcessEnv;
    } = {},
): RegistrySelection {
    const environment = options.environment ?? process.env;

    const scope = packageScope(packageName)?.toLowerCase();

    const requested =
        options.registry ??
        environment.WIZ_REGISTRY ??
        (scope === undefined ? undefined : options.project?.scopes?.[scope]) ??
        (scope === undefined ? undefined : user.scopes[scope]?.registry) ??
        options.project?.default ??
        user.defaultRegistry ??
        "official";

    const directUrl = /^https?:\/\//.test(requested);

    const entry = directUrl
        ? { url: normalizeRegistryUrl(requested) }
        : user.registries[requested];

    if (entry === undefined) {
        throw new RegistryError(`Registry is not configured: ${requested}`, {
            code: "REGISTRY_NOT_CONFIGURED",
            status: 400,
        });
    }

    const token = options.token ?? environment.WIZ_TOKEN ?? entry.token;

    return {
        name: directUrl ? entry.url : requested,
        url: entry.url,
        ...(token === undefined ? {} : { token }),
    };
}
