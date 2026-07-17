import { WizError } from "@wiz-sh/pm";
import {
    loadUserRegistryConfig,
    normalizeRegistryUrl,
    RegistryClient,
    RegistryError,
    saveUserRegistryConfig,
    selectRegistry,
    type UserRegistryConfig,
    userConfigPath,
} from "@wiz-sh/registry-client";

function required(value: string | undefined, label: string): string {
    if (value === undefined || value.trim() === "") {
        throw new WizError(`Missing ${label}`);
    }

    return value;
}

function masked(token: string | undefined): string {
    if (token === undefined) {
        return "not configured";
    }

    return token.length <= 8
        ? "********"
        : `${token.slice(0, 4)}…${token.slice(-4)}`;
}

async function update(
    transform: (config: UserRegistryConfig) => UserRegistryConfig,
): Promise<UserRegistryConfig> {
    const config = transform(await loadUserRegistryConfig());

    await saveUserRegistryConfig(config);

    return config;
}

function registryName(args: readonly string[], fallback = "official"): string {
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];

        if (argument === "--token") {
            index += 1;

            continue;
        }

        if (argument !== undefined && !argument.startsWith("-")) {
            return argument;
        }
    }

    return fallback;
}

function tokenArgument(args: readonly string[]): string | undefined {
    const index = args.indexOf("--token");

    return index < 0 ? undefined : args[index + 1];
}

async function identity(name: string): Promise<number> {
    const config = await loadUserRegistryConfig();

    const selected = selectRegistry("wiz", config, { registry: name });

    const client = new RegistryClient({
        baseUrl: selected.url,
        ...(selected.token === undefined ? {} : { token: selected.token }),
    });

    try {
        const user = await client.whoami();

        console.log(`${user.username} (${selected.name})`);

        return 0;
    } catch (err) {
        if (err instanceof RegistryError && [401, 403].includes(err.status)) {
            throw new WizError(`Not logged in to ${selected.name}`);
        }

        throw err;
    }
}

async function setToken(
    name: string,
    token: string | undefined,
): Promise<number> {
    const resolvedToken = token ?? process.env.WIZ_TOKEN;

    if (resolvedToken === undefined || resolvedToken.trim() === "") {
        throw new WizError(
            "A token is required through --token or WIZ_TOKEN for non-interactive login",
        );
    }

    await update((config) => {
        const entry = config.registries[name];

        if (entry === undefined) {
            throw new WizError(`Unknown registry: ${name}`);
        }

        return {
            ...config,
            registries: {
                ...config.registries,
                [name]: { ...entry, token: resolvedToken },
            },
        };
    });

    console.log(`Stored token for ${name} (${masked(resolvedToken)})`);

    return 0;
}

async function deviceLogin(name: string): Promise<number> {
    const config = await loadUserRegistryConfig();

    const selected = selectRegistry("wiz", config, { registry: name });

    const client = new RegistryClient({ baseUrl: selected.url });

    const authorization = await client.users.beginDeviceAuthorization();

    console.log(
        `Open ${authorization.verificationUri} and enter ${authorization.userCode}`,
    );

    const expiresAt = new Date(authorization.expiresAt).getTime();

    while (Date.now() < expiresAt) {
        const result = await client.users.exchangeDeviceCode(
            authorization.deviceCode,
        );

        if (result.state === "authenticated") {
            return setToken(name, result.token);
        }

        await Bun.sleep(authorization.interval * 1_000);
    }

    throw new WizError("Device authorization expired before it was approved");
}

async function logout(name: string): Promise<number> {
    await update((config) => {
        const entry = config.registries[name];

        if (entry === undefined) {
            throw new WizError(`Unknown registry: ${name}`);
        }

        const { token: _token, ...withoutToken } = entry;

        return {
            ...config,
            registries: {
                ...config.registries,
                [name]: withoutToken,
            },
        };
    });

    console.log(`Logged out of ${name}`);

    return 0;
}

/** Runs registry configuration and authentication commands. */
export async function registryMain(args: readonly string[]): Promise<number> {
    const command = args[0];

    if (command === undefined || command === "list") {
        const config = await loadUserRegistryConfig();

        for (const [name, entry] of Object.entries(
            config.registries,
        ).toSorted()) {
            const marker = name === config.defaultRegistry ? "*" : " ";

            console.log(
                `${marker} ${name}  ${entry.url}  ${masked(entry.token)}`,
            );
        }

        return 0;
    }

    if (command === "get") {
        const name = required(args[1], "registry name");

        const config = await loadUserRegistryConfig();

        const entry = config.registries[name];

        if (entry === undefined) {
            throw new WizError(`Unknown registry: ${name}`);
        }

        console.log(
            `${name}\n  URL: ${entry.url}\n  Token: ${masked(entry.token)}`,
        );

        return 0;
    }

    if (command === "add") {
        const name = required(args[1], "registry name");

        const url = normalizeRegistryUrl(required(args[2], "registry URL"));

        await update((config) => {
            if (config.registries[name] !== undefined) {
                throw new WizError(`Registry already exists: ${name}`);
            }

            return {
                ...config,
                registries: {
                    ...config.registries,
                    [name]: { url },
                },
            };
        });

        console.log(`Added registry ${name}: ${url}`);

        return 0;
    }

    if (command === "set-default") {
        const name = required(args[1], "registry name");

        await update((config) => {
            if (config.registries[name] === undefined) {
                throw new WizError(`Unknown registry: ${name}`);
            }

            return { ...config, defaultRegistry: name };
        });

        console.log(`Default registry is now ${name}`);

        return 0;
    }

    if (command === "remove") {
        const name = required(args[1], "registry name");

        await update((config) => {
            if (name === "official") {
                throw new WizError(
                    "The built-in official registry cannot be removed",
                );
            }

            if (config.registries[name] === undefined) {
                throw new WizError(`Unknown registry: ${name}`);
            }

            const registries = { ...config.registries };

            delete registries[name];

            const scopes = Object.fromEntries(
                Object.entries(config.scopes).filter(([, scope]) => {
                    return scope.registry !== name;
                }),
            );

            return {
                ...config,
                defaultRegistry:
                    config.defaultRegistry === name
                        ? "official"
                        : config.defaultRegistry,
                registries,
                scopes,
            };
        });

        console.log(`Removed registry ${name}`);

        return 0;
    }

    if (command === "set-token") {
        return setToken(
            required(args[1], "registry name"),
            tokenArgument(args.slice(2)) ?? args[2],
        );
    }

    if (command === "logout") {
        return logout(registryName(args.slice(1)));
    }

    if (command === "whoami") {
        return identity(registryName(args.slice(1)));
    }

    if (command === "ping") {
        const name = registryName(args.slice(1));

        const config = await loadUserRegistryConfig();

        const selected = selectRegistry("wiz", config, { registry: name });

        const client = new RegistryClient({ baseUrl: selected.url });

        await client.health();

        console.log(`${selected.name} is reachable at ${selected.url}`);

        return 0;
    }

    throw new WizError(
        `Unknown registry command: ${command}\nConfiguration: ${userConfigPath()}`,
    );
}

export async function loginMain(args: readonly string[]): Promise<number> {
    const name = registryName(args);

    const token = tokenArgument(args) ?? process.env.WIZ_TOKEN;

    if (token === undefined) {
        return deviceLogin(name);
    }

    const config = await loadUserRegistryConfig();

    const selected = selectRegistry("wiz", config, { registry: name });

    await new RegistryClient({
        baseUrl: selected.url,
        token,
    }).whoami();

    return setToken(name, token);
}

export async function logoutMain(args: readonly string[]): Promise<number> {
    return logout(registryName(args));
}

export async function whoamiMain(args: readonly string[]): Promise<number> {
    return identity(registryName(args));
}
