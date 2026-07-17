import type { WizConfig } from "./types.ts";

export function defaultConfig(projectRoot: string): WizConfig {
    return {
        projectRoot,
        compiler: {
            target: "bash",
            rootDir: "src",
            outDir: "dist",
            sourceMap: true,
            declaration: false,
            noEmitOnError: true,
            runtimeChecks: "boundaries",
            bundle: false,
            minify: false,
        },
        typeChecking: {
            strict: true,
            allowAny: false,
            implicitAny: false,
            unknownCommands: "warning",
            checkSourcedFiles: true,
            checkDeclarationFiles: true,
            types: [],
        },
        formatter: {
            indentStyle: "space",
            indentWidth: 4,
            lineWidth: 100,
            quoteStyle: "preserve",
            trailingNewline: true,
        },
        linter: {
            enabled: true,
            recommended: true,
            rules: {},
        },
        files: {
            include: ["src/**/*.wiz", "src/**/*.d.wiz"],
            exclude: ["dist/**", "node_modules/**", "wiz_modules/**"],
        },
    };
}
