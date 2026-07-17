export type PackageVisibility = "public" | "private";

export interface RegistryEntry {
    url: string;
    token?: string;
    allowInsecure?: boolean;
}

export interface RegistryScopeEntry {
    registry: string;
}

export interface UserRegistryConfig {
    defaultRegistry: string;
    registries: Readonly<Record<string, RegistryEntry>>;
    scopes: Readonly<Record<string, RegistryScopeEntry>>;
}

export interface ProjectRegistryConfig {
    default?: string;
    scopes?: Readonly<Record<string, string>>;
}

export interface RegistrySelection {
    name: string;
    url: string;
    token?: string;
}

export interface RegistryRequestOptions {
    signal?: AbortSignal;
    requestId?: string;
    idempotencyKey?: string;
}

export interface CursorPage<T> {
    items: readonly T[];
    nextCursor?: string;
}

export interface RegistryUser {
    id: string;
    username: string;
    email?: string;
    emailVerified: boolean;
    mfaEnabled: boolean;
}

export interface RegistryPackageVersion {
    packageName: string;
    version: string;
    integrity: string;
    archiveUrl: string;
    archiveSize: number;
    manifest: Readonly<Record<string, unknown>>;
    publishedAt: string;
    deprecated?: string;
}

export interface RegistryPackage {
    id: string;
    name: string;
    description?: string;
    visibility: PackageVisibility;
    latestVersion?: string;
    distTags: Readonly<Record<string, string>>;
}

export interface RegistryPackageSearch {
    query: string;
    cursor?: string;
    scope?: string;
    owner?: string;
    keyword?: string;
    visibility?: PackageVisibility;
    sort?: "relevance" | "name" | "name-desc" | "recent";
    limit?: number;
}

export interface PublishTransaction {
    id: string;
    packageName: string;
    version: string;
    state: "created" | "uploaded" | "processing" | "published" | "failed";
    uploadUrl?: string;
    error?: string;
}

export interface RegistryOrganization {
    id: string;
    name: string;
    displayName: string;
    role?: string;
}

export interface AccessTokenSummary {
    id: string;
    name: string;
    prefix: string;
    scopes: readonly string[];
    expiresAt?: string;
    lastUsedAt?: string;
}

export interface RegistryLoginResult {
    state: "authenticated" | "mfa_required";
    token?: string;
    challengeId?: string;
    expiresAt?: string;
}

export interface RegistryInvitation {
    id: string;
    organization: string;
    role: string;
    expiresAt: string;
}

export interface RegistryTeam {
    id: string;
    name: string;
    description?: string;
}

export interface RegistryAuditEvent {
    id: string;
    action: string;
    metadata: Readonly<Record<string, unknown>>;
    createdAt: string;
}

export type RegistryWebhookEvent =
    | "package.created"
    | "package.updated"
    | "package.published"
    | "package.deprecated"
    | "package.unpublished"
    | "package.transferred"
    | "package.visibility_changed"
    | "org.member_added"
    | "org.member_removed"
    | "org.invitation_created"
    | "security.package_quarantined";

export interface RegistryWebhook {
    id: string;
    url: string;
    events: readonly RegistryWebhookEvent[];
    active: boolean;
    createdAt: string;
}

export interface CreatedRegistryWebhook extends RegistryWebhook {
    secret: string;
}

export interface RegistryWebhookDelivery {
    id: string;
    eventId: string;
    event: string;
    attempt: number;
    status: "pending" | "delivered" | "failed";
    responseStatus?: number;
    responseExcerpt?: string;
    createdAt: string;
}

export interface RegistryAbuseReport {
    id: string;
    packageId?: string;
    reporterId?: string;
    reason: string;
    details: string;
    status: "open" | "actioned" | "resolved" | "dismissed";
    createdAt: string;
}

export interface RegistryModerationAction {
    id: string;
    reportId?: string;
    packageId?: string;
    action: "quarantine" | "restore" | "resolve" | "dismiss";
    reason: string;
    createdAt: string;
}

export interface CreateTokenInput {
    name: string;
    scopes: readonly string[];
    type: "personal" | "automation";
    expiresAt?: string;
    packages?: readonly string[];
}

export interface CreatedAccessToken extends AccessTokenSummary {
    token: string;
}
