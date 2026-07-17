import type {
    DependencySpec,
    PackageMetadata,
} from "../../packages/pm/src/types.ts";

interface ManifestOptions {
    package?: Omit<PackageMetadata, "name">;
    scripts?: Record<string, string>;
    bin?: Record<string, string>;
    dependencies?: Record<string, DependencySpec>;
    workspaces?: readonly string[];
}

export function manifest(name: string, options: ManifestOptions = {}): string {
    const { index, ...metadata } = options.package ?? {};

    const value = {
        name,
        ...metadata,
        ...(index === undefined ? {} : { main: index }),
        scripts: options.scripts ?? {},
        bin: options.bin ?? {},
        dependencies: options.dependencies ?? {},
        ...(options.workspaces === undefined
            ? {}
            : { workspaces: options.workspaces }),
    };

    return `${JSON.stringify(value, null, 4)}\n`;
}
