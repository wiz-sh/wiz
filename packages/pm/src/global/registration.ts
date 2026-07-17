import { WizError } from "../utils/errors.ts";
import type { JsonValue } from "../utils/json.ts";

export interface BinRegistration {
    package: string;
    repo: string;
    commit: string;
    bin: string;
    path: string;
    branch?: string;
}

export type BinState = Record<string, BinRegistration>;

export interface GlobalPackageRegistration {
    name: string;
    repo: string;
    commit: string;
    branch?: string;
}

export type GlobalPackageState = Record<string, GlobalPackageRegistration>;

export interface GlobalLinkRegistration {
    path: string;
    bins: Readonly<Record<string, string>>;
}

export type GlobalLinkState = Record<string, GlobalLinkRegistration>;

export interface ProjectLinkRegistration {
    path: string;
}

export type ProjectLinkState = Record<string, ProjectLinkRegistration>;

export function requiredString(
    value: JsonValue | undefined,
    label: string,
): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new WizError(`${label} must be a non-empty string`);
    }

    return value;
}

export function optionalBranch(
    value: JsonValue | undefined,
    label: string,
): { branch?: string } {
    if (value === undefined) {
        return {};
    }

    return {
        branch: requiredString(value, label),
    };
}
