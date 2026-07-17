const unscopedName = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const reserved = new Set([
    "admin",
    "api",
    "auth",
    "favicon.ico",
    "health",
    "openapi",
    "registry",
    "root",
    "support",
    "wiz_modules",
]);

export function normalizeIdentity(value: string): string {
    return value.normalize("NFKC").toLowerCase();
}

function validSegment(value: string): boolean {
    return (
        unscopedName.test(value) &&
        !reserved.has(value) &&
        !value.includes("..") &&
        !/[\p{C}\p{Z}]/u.test(value)
    );
}

/** Package names are deliberately ASCII to avoid visually confusable scopes. */
export function normalizePackageName(value: string): string {
    const normalized = normalizeIdentity(value);

    if (normalized.startsWith("@")) {
        const [scope, name, extra] = normalized.slice(1).split("/");

        if (
            scope === undefined ||
            name === undefined ||
            extra !== undefined ||
            !validSegment(scope) ||
            !validSegment(name)
        ) {
            throw new Error("Invalid scoped package name");
        }

        return `@${scope}/${name}`;
    }

    if (!validSegment(normalized)) {
        throw new Error("Invalid package name");
    }

    return normalized;
}

export function packageScope(value: string): string | undefined {
    const normalized = normalizePackageName(value);

    return normalized.startsWith("@")
        ? normalized.slice(1).split("/")[0]
        : undefined;
}
