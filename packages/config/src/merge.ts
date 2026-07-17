function isObject(value: unknown): value is object {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeConfig<T extends object>(
    base: T,
    override: Partial<T>,
): T {
    const result = { ...base };

    for (const key of Object.keys(override) as Array<keyof T>) {
        const next = override[key];

        const previous = result[key];

        if (next === undefined) {
            continue;
        }

        if (isObject(previous) && isObject(next)) {
            result[key] = mergeConfig(previous, next) as T[keyof T];
        } else {
            result[key] = next as T[keyof T];
        }
    }

    return result;
}
