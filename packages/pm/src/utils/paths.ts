import { isAbsolute, relative, resolve } from "node:path";
import { WizError } from "./errors.ts";
import type { JsonValue } from "./json.ts";

export function safeRelativePath(
    value: JsonValue | undefined,
    label: string,
): string {
    if (typeof value !== "string" || value.length === 0 || isAbsolute(value)) {
        throw new WizError(`${label} must be a non-empty relative path`);
    }

    const normalized = relative(".", resolve(".", value));

    if (
        normalized === ".." ||
        normalized.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    ) {
        throw new WizError(`${label} escapes the package root`);
    }

    return normalized || ".";
}

export function resolveInside(
    root: string,
    value: string,
    label: string,
): string {
    const target = resolve(root, value);

    const rel = relative(root, target);

    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
        throw new WizError(`${label} escapes the package root`);
    }

    return target;
}
