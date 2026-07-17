import { expect, test } from "bun:test";
import { RegistryClient } from "../src/client.ts";

test("webhook client methods encode scoped owners and identifiers", async () => {
    const paths: string[] = [];

    const server = Bun.serve({
        port: 0,
        fetch(request) {
            paths.push(new URL(request.url).pathname);

            return Response.json({ items: [] });
        },
    });

    const client = new RegistryClient({
        baseUrl: server.url.toString(),
        token: "wiz_pat_test",
    });

    await client.webhooks.list({ packageName: "@wiz/compiler" });

    await client.webhooks.deliveries({ organization: "wiz" }, "webhook-id");

    expect(paths[0]).toBe("/v1/packages/%40wiz%2Fcompiler/webhooks");

    expect(paths[1]).toBe("/v1/orgs/wiz/webhooks/webhook-id/deliveries");

    server.stop(true);
});
