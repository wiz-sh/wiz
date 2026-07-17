import type { CommandArgument } from "../../ast/source-file.ts";
import type { WizType } from "../../types/type.ts";

export type ForeignTarget = "fish" | "powershell" | "cmd";

// The callable interface avoids compact arrow signatures in the public surface.
export interface ForeignValueTransformer {
    // biome-ignore lint/style/useShorthandFunctionType: spacious callable contract
    (value: string): string;
}

export function unquote(value: string): string {
    const quote = value[0];

    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
        return value.slice(1, -1);
    }

    return value;
}

export function powerShellType(type: WizType): string {
    if (type.kind === "array") {
        const element = type.element;

        return element === undefined
            ? "[object[]]"
            : `[${powerShellType(element).slice(1, -1)}[]]`;
    }

    if (type.name === "int" || type.name === "status") {
        return "[int]";
    }

    if (type.name === "bool") {
        return "[bool]";
    }

    return "[string]";
}

export function powerShellValue(value: string): string {
    return value
        .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "$$$1")
        .replace(/\$([1-9][0-9]*)/g, (_match, position: string) => {
            return `$args[${Number(position) - 1}]`;
        })
        .replace(/\$\?/g, "$LASTEXITCODE");
}

export function fishValue(value: string): string {
    return value
        .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "$$$1")
        .replace(/\$\(([^)]*)\)/g, "($1)");
}

export function cmdValue(value: string): string {
    return value
        .replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, "!$1!")
        .replace(/\$([1-9])/g, "%$1")
        .replace(/\$\?/g, "%ERRORLEVEL%");
}

/** Removes shell quoting before placing a value inside CMD's set "name=value" form. */
export function cmdAssignmentValue(value: string): string {
    return cmdValue(unquote(value));
}

/** Resolves generated modules beside the entry script rather than the caller's CWD. */
export function foreignSourceCommand(
    value: string,
    target: ForeignTarget,
): string {
    const extension =
        target === "powershell" ? ".ps1" : target === "fish" ? ".fish" : ".cmd";

    const source = unquote(value).replace(/\.wiz$/, extension);

    const relative = source.replace(/^\.\//, "");

    if (target === "powershell") {
        return source.startsWith("./")
            ? `. (Join-Path $PSScriptRoot '${relative.replace(/'/g, "''")}')`
            : `. '${source.replace(/'/g, "''")}'`;
    }

    if (target === "fish") {
        const escaped = relative.replace(/'/g, "\\'");

        return source.startsWith("./")
            ? `source (path dirname (status filename))/'${escaped}'`
            : `source '${source.replace(/'/g, "\\'")}'`;
    }

    return source.startsWith("./")
        ? `call "%~dp0${cmdValue(relative)}"`
        : `call "${cmdValue(source)}"`;
}

export function commandArgumentsText(
    argumentsList: readonly CommandArgument[],
    transform: ForeignValueTransformer,
): string {
    return argumentsList
        .map((argument) => {
            return transform(argument.value);
        })
        .join(" ");
}
