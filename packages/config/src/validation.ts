import type { ConfigDiagnostic } from "./types.ts";

const allowed = {
    root: new Set([
        "$schema",
        "extends",
        "compiler",
        "typeChecking",
        "formatter",
        "linter",
        "files",
    ]),
    compiler: new Set([
        "target",
        "rootDir",
        "outDir",
        "sourceMap",
        "declaration",
        "noEmitOnError",
        "runtimeChecks",
        "bundle",
        "minify",
    ]),
    typeChecking: new Set([
        "strict",
        "allowAny",
        "implicitAny",
        "unknownCommands",
        "checkSourcedFiles",
        "checkDeclarationFiles",
        "types",
    ]),
    formatter: new Set([
        "indentStyle",
        "indentWidth",
        "lineWidth",
        "quoteStyle",
        "trailingNewline",
    ]),
    linter: new Set(["enabled", "recommended", "rules"]),
    files: new Set(["include", "exclude"]),
};

function record(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return undefined;
    }

    return value as Record<string, unknown>;
}

function diagnostic(
    diagnostics: ConfigDiagnostic[],
    path: string,
    message: string,
): void {
    diagnostics.push({
        code: "WIZCFG003",
        severity: "error",
        message,
        path,
    });
}

function validateKeys(
    value: Record<string, unknown>,
    keys: ReadonlySet<string>,
    prefix: string,
    diagnostics: ConfigDiagnostic[],
): void {
    for (const key of Object.keys(value)) {
        if (!keys.has(key)) {
            diagnostics.push({
                code: "WIZCFG001",
                severity: "error",
                message: `Unknown configuration key: ${prefix}${key}`,
                path: `${prefix}${key}`,
            });
        }
    }
}

function optionalBoolean(
    section: Record<string, unknown>,
    key: string,
    path: string,
    diagnostics: ConfigDiagnostic[],
): void {
    if (section[key] !== undefined && typeof section[key] !== "boolean") {
        diagnostic(diagnostics, path, `${path} must be a boolean`);
    }
}

function optionalString(
    section: Record<string, unknown>,
    key: string,
    path: string,
    diagnostics: ConfigDiagnostic[],
): void {
    const value = section[key];

    if (
        value !== undefined &&
        (typeof value !== "string" || value.trim().length === 0)
    ) {
        diagnostic(diagnostics, path, `${path} must be a non-empty string`);
    }
}

function optionalEnum(
    section: Record<string, unknown>,
    key: string,
    path: string,
    values: readonly string[],
    diagnostics: ConfigDiagnostic[],
): void {
    const value = section[key];

    if (value !== undefined && !values.includes(String(value))) {
        diagnostic(
            diagnostics,
            path,
            `${path} must be one of: ${values.join(", ")}`,
        );
    }
}

function optionalInteger(
    section: Record<string, unknown>,
    key: string,
    path: string,
    minimum: number,
    maximum: number,
    diagnostics: ConfigDiagnostic[],
): void {
    const value = section[key];

    if (
        value !== undefined &&
        (!Number.isInteger(value) ||
            Number(value) < minimum ||
            Number(value) > maximum)
    ) {
        diagnostic(
            diagnostics,
            path,
            `${path} must be an integer from ${minimum} through ${maximum}`,
        );
    }
}

function optionalStringArray(
    section: Record<string, unknown>,
    key: string,
    path: string,
    diagnostics: ConfigDiagnostic[],
): void {
    const value = section[key];

    if (value === undefined) {
        return;
    }

    if (
        !Array.isArray(value) ||
        value.some((entry) => {
            return typeof entry !== "string" || entry.trim() === "";
        })
    ) {
        diagnostic(
            diagnostics,
            path,
            `${path} must be an array of package names`,
        );
    }
}

function section(
    root: Record<string, unknown>,
    name: keyof Omit<typeof allowed, "root">,
    diagnostics: ConfigDiagnostic[],
): Record<string, unknown> | undefined {
    const value = root[name];

    if (value === undefined) {
        return undefined;
    }

    const result = record(value);

    if (result === undefined) {
        diagnostic(diagnostics, name, `${name} must be an object`);

        return undefined;
    }

    validateKeys(result, allowed[name], `${name}.`, diagnostics);

    return result;
}

function validateCompiler(
    root: Record<string, unknown>,
    diagnostics: ConfigDiagnostic[],
): void {
    const value = section(root, "compiler", diagnostics);

    if (value === undefined) {
        return;
    }

    optionalEnum(
        value,
        "target",
        "compiler.target",
        ["bash", "zsh", "sh", "fish", "powershell", "cmd"],
        diagnostics,
    );

    optionalString(value, "rootDir", "compiler.rootDir", diagnostics);

    optionalString(value, "outDir", "compiler.outDir", diagnostics);

    optionalBoolean(value, "sourceMap", "compiler.sourceMap", diagnostics);

    optionalBoolean(value, "declaration", "compiler.declaration", diagnostics);

    optionalBoolean(
        value,
        "noEmitOnError",
        "compiler.noEmitOnError",
        diagnostics,
    );

    optionalEnum(
        value,
        "runtimeChecks",
        "compiler.runtimeChecks",
        ["none", "boundaries", "all"],
        diagnostics,
    );

    optionalBoolean(value, "bundle", "compiler.bundle", diagnostics);

    optionalBoolean(value, "minify", "compiler.minify", diagnostics);
}

function validateTypeChecking(
    root: Record<string, unknown>,
    diagnostics: ConfigDiagnostic[],
): void {
    const value = section(root, "typeChecking", diagnostics);

    if (value === undefined) {
        return;
    }

    for (const key of [
        "strict",
        "allowAny",
        "implicitAny",
        "checkSourcedFiles",
        "checkDeclarationFiles",
    ]) {
        optionalBoolean(value, key, `typeChecking.${key}`, diagnostics);
    }

    optionalEnum(
        value,
        "unknownCommands",
        "typeChecking.unknownCommands",
        ["allow", "warning", "error"],
        diagnostics,
    );

    optionalStringArray(value, "types", "typeChecking.types", diagnostics);
}

function validateFormatter(
    root: Record<string, unknown>,
    diagnostics: ConfigDiagnostic[],
): void {
    const value = section(root, "formatter", diagnostics);

    if (value === undefined) {
        return;
    }

    optionalEnum(
        value,
        "indentStyle",
        "formatter.indentStyle",
        ["space", "tab"],
        diagnostics,
    );

    optionalInteger(
        value,
        "indentWidth",
        "formatter.indentWidth",
        1,
        16,
        diagnostics,
    );

    optionalInteger(
        value,
        "lineWidth",
        "formatter.lineWidth",
        40,
        320,
        diagnostics,
    );

    optionalEnum(
        value,
        "quoteStyle",
        "formatter.quoteStyle",
        ["preserve"],
        diagnostics,
    );

    optionalBoolean(
        value,
        "trailingNewline",
        "formatter.trailingNewline",
        diagnostics,
    );
}

function validateLinter(
    root: Record<string, unknown>,
    diagnostics: ConfigDiagnostic[],
): void {
    const value = section(root, "linter", diagnostics);

    if (value === undefined) {
        return;
    }

    optionalBoolean(value, "enabled", "linter.enabled", diagnostics);

    optionalBoolean(value, "recommended", "linter.recommended", diagnostics);

    if (value.rules === undefined) {
        return;
    }

    const rules = record(value.rules);

    if (rules === undefined) {
        diagnostic(
            diagnostics,
            "linter.rules",
            "linter.rules must be an object",
        );

        return;
    }

    for (const [name, severity] of Object.entries(rules)) {
        if (!["off", "warning", "error"].includes(String(severity))) {
            diagnostic(
                diagnostics,
                `linter.rules.${name}`,
                `linter.rules.${name} must be off, warning, or error`,
            );
        }
    }
}

function validateFiles(
    root: Record<string, unknown>,
    diagnostics: ConfigDiagnostic[],
): void {
    const value = section(root, "files", diagnostics);

    if (value === undefined) {
        return;
    }

    for (const key of ["include", "exclude"]) {
        const paths = value[key];

        if (
            paths !== undefined &&
            (!Array.isArray(paths) ||
                paths.some((path) => {
                    return typeof path !== "string" || path.length === 0;
                }))
        ) {
            diagnostic(
                diagnostics,
                `files.${key}`,
                `files.${key} must be an array of non-empty strings`,
            );
        }
    }
}

/** Validates runtime configuration with the same constraints as the JSON Schema. */
export function validateConfigValue(value: unknown): ConfigDiagnostic[] {
    const diagnostics: ConfigDiagnostic[] = [];

    const root = record(value);

    if (root === undefined) {
        return [
            {
                code: "WIZCFG002",
                severity: "error",
                message: "Configuration must be a JSON object",
            },
        ];
    }

    validateKeys(root, allowed.root, "", diagnostics);

    optionalString(root, "$schema", "$schema", diagnostics);

    optionalString(root, "extends", "extends", diagnostics);

    validateCompiler(root, diagnostics);

    validateTypeChecking(root, diagnostics);

    validateFormatter(root, diagnostics);

    validateLinter(root, diagnostics);

    validateFiles(root, diagnostics);

    return diagnostics;
}
