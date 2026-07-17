import { dirname, resolve } from "node:path";
import type { WizConfig } from "./types.ts";

export function normalizeConfig(
    config: WizConfig,
    configPath?: string,
): WizConfig {
    const root =
        configPath === undefined
            ? resolve(config.projectRoot)
            : dirname(configPath);

    return {
        ...config,
        projectRoot: root,
        ...(configPath === undefined ? {} : { configPath }),
        compiler: {
            ...config.compiler,
            rootDir: resolve(root, config.compiler.rootDir),
            outDir: resolve(root, config.compiler.outDir),
        },
    };
}
