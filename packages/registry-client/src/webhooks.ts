import type { RegistryTransport } from "./transport.ts";
import type {
    CreatedRegistryWebhook,
    CursorPage,
    RegistryRequestOptions,
    RegistryWebhook,
    RegistryWebhookDelivery,
    RegistryWebhookEvent,
} from "./types.ts";

export interface CreateWebhookInput {
    url: string;
    events: readonly RegistryWebhookEvent[];
}

type WebhookOwner = { packageName: string } | { organization: string };

function ownerPath(owner: WebhookOwner): string {
    if ("packageName" in owner) {
        return `/v1/packages/${encodeURIComponent(owner.packageName)}`;
    }

    return `/v1/orgs/${encodeURIComponent(owner.organization)}`;
}

export class RegistryWebhooksResource {
    constructor(private readonly transport: RegistryTransport) {}

    create(
        owner: WebhookOwner,
        input: CreateWebhookInput,
        options: RegistryRequestOptions = {},
    ): Promise<CreatedRegistryWebhook> {
        return this.transport.request({
            method: "POST",
            path: `${ownerPath(owner)}/webhooks`,
            body: input,
            ...options,
        });
    }

    list(
        owner: WebhookOwner,
        options: RegistryRequestOptions = {},
    ): Promise<CursorPage<RegistryWebhook>> {
        return this.transport.request({
            path: `${ownerPath(owner)}/webhooks`,
            ...options,
        });
    }

    remove(
        owner: WebhookOwner,
        webhookId: string,
        options: RegistryRequestOptions = {},
    ): Promise<void> {
        return this.transport.request({
            method: "DELETE",
            path: `${ownerPath(owner)}/webhooks/${encodeURIComponent(webhookId)}`,
            ...options,
        });
    }

    test(
        owner: WebhookOwner,
        webhookId: string,
        options: RegistryRequestOptions = {},
    ): Promise<RegistryWebhookDelivery> {
        return this.transport.request({
            method: "POST",
            path: `${ownerPath(owner)}/webhooks/${encodeURIComponent(webhookId)}/test`,
            ...options,
        });
    }

    deliveries(
        owner: WebhookOwner,
        webhookId: string,
        options: RegistryRequestOptions = {},
    ): Promise<CursorPage<RegistryWebhookDelivery>> {
        return this.transport.request({
            path: `${ownerPath(owner)}/webhooks/${encodeURIComponent(webhookId)}/deliveries`,
            ...options,
        });
    }

    retry(
        owner: WebhookOwner,
        webhookId: string,
        deliveryId: string,
        options: RegistryRequestOptions = {},
    ): Promise<RegistryWebhookDelivery> {
        return this.transport.request({
            method: "POST",
            path: `${ownerPath(owner)}/webhooks/${encodeURIComponent(webhookId)}/deliveries/${encodeURIComponent(deliveryId)}/retry`,
            ...options,
        });
    }
}
