import type { RegistryTransport } from "./transport.ts";
import type {
    CursorPage,
    RegistryAuditEvent,
    RegistryInvitation,
    RegistryOrganization,
    RegistryRequestOptions,
    RegistryTeam,
} from "./types.ts";

function path(name: string): string {
    return `/v1/orgs/${encodeURIComponent(name)}`;
}

export class RegistryOrganizationsResource {
    constructor(private readonly transport: RegistryTransport) {}

    create(
        input: { name: string; displayName: string; private?: boolean },
        options: RegistryRequestOptions = {},
    ): Promise<RegistryOrganization> {
        return this.transport.request({
            method: "POST",
            path: "/v1/orgs",
            body: input,
            ...options,
        });
    }

    list(
        options: RegistryRequestOptions = {},
    ): Promise<CursorPage<RegistryOrganization>> {
        return this.transport.request({ path: "/v1/orgs", ...options });
    }

    invite(
        organization: string,
        input: { username?: string; email?: string; role: string },
        options: RegistryRequestOptions = {},
    ): Promise<RegistryInvitation & { token: string }> {
        return this.transport.request({
            method: "POST",
            path: `${path(organization)}/invitations`,
            body: input,
            ...options,
        });
    }

    teams(
        organization: string,
        options: RegistryRequestOptions = {},
    ): Promise<CursorPage<RegistryTeam>> {
        return this.transport.request({
            path: `${path(organization)}/teams`,
            ...options,
        });
    }

    audit(
        organization: string,
        options: RegistryRequestOptions = {},
    ): Promise<CursorPage<RegistryAuditEvent>> {
        return this.transport.request({
            path: `${path(organization)}/audit-log`,
            ...options,
        });
    }
}
