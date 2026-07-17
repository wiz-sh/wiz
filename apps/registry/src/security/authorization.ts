export type PackagePermission =
    | "read"
    | "triage"
    | "publish"
    | "manage"
    | "admin";

export type OrganizationRole =
    | "owner"
    | "admin"
    | "maintainer"
    | "member"
    | "billing"
    | "viewer";

const packageRank: Readonly<Record<PackagePermission, number>> = {
    read: 1,
    triage: 2,
    publish: 3,
    manage: 4,
    admin: 5,
};

const rolePermissions: Readonly<
    Record<OrganizationRole, readonly PackagePermission[]>
> = {
    owner: ["admin"],
    admin: ["admin"],
    maintainer: ["manage"],
    member: ["read"],
    billing: [],
    viewer: ["read"],
};

export function permissionAllows(
    granted: PackagePermission,
    required: PackagePermission,
): boolean {
    return packageRank[granted] >= packageRank[required];
}

export function roleAllowsPackage(
    role: OrganizationRole,
    required: PackagePermission,
): boolean {
    return rolePermissions[role].some((permission) => {
        return permissionAllows(permission, required);
    });
}

export function assertTokenScopes(
    actual: readonly string[],
    requested: readonly string[],
): void {
    if (
        requested.some((scope) => {
            return !actual.includes(scope);
        })
    ) {
        throw new RegistryHttpError(
            "INSUFFICIENT_PERMISSION",
            403,
            "Token scope escalation is not allowed.",
        );
    }
}

export function requireTokenScope(
    actual: readonly string[],
    required: string,
): void {
    if (!actual.includes(required)) {
        throw new RegistryHttpError(
            "INSUFFICIENT_PERMISSION",
            403,
            `The ${required} token scope is required.`,
        );
    }
}

import { RegistryHttpError } from "../middleware/errors.ts";
