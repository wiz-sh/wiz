import type { RegistryEntry, UserRegistryConfig } from "./types.ts";

export interface CredentialProvider {
    token(name: string, entry: RegistryEntry): Promise<string | undefined>;
}

/** Gives CI an explicit secret channel without mutating persistent configuration. */
export class EnvironmentCredentialProvider implements CredentialProvider {
    constructor(
        private readonly environment: NodeJS.ProcessEnv = process.env,
    ) {}

    async token(): Promise<string | undefined> {
        return this.environment.WIZ_TOKEN;
    }
}

/** Compatibility provider for config files until native credential stores are added. */
export class ConfigCredentialProvider implements CredentialProvider {
    constructor(private readonly config: UserRegistryConfig) {}

    async token(name: string): Promise<string | undefined> {
        return this.config.registries[name]?.token;
    }
}

export class CredentialChain implements CredentialProvider {
    constructor(private readonly providers: readonly CredentialProvider[]) {}

    async token(
        name: string,
        entry: RegistryEntry,
    ): Promise<string | undefined> {
        for (const provider of this.providers) {
            const token = await provider.token(name, entry);

            if (token !== undefined) {
                return token;
            }
        }

        return undefined;
    }
}
