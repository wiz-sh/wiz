import { expect, test } from "bun:test";
import {
    validateWebhookDestination,
    webhookSignature,
} from "../src/services/webhook-service.ts";

test("webhook destinations reject credentials and private networks", async () => {
    const rejected = [
        "http://example.com/hook",
        "https://user:password@example.com/hook",
        "https://localhost/hook",
        "https://127.0.0.1/hook",
        "https://10.1.2.3/hook",
        "https://169.254.169.254/latest/meta-data",
        "https://[::1]/hook",
    ];

    for (const value of rejected) {
        await expect(validateWebhookDestination(value)).rejects.toThrow();
    }

    expect(
        (await validateWebhookDestination("https://example.com/hook")).hostname,
    ).toBe("example.com");
});

test("webhook signatures cover both timestamp and exact body", () => {
    const signature = webhookSignature(
        "secret",
        "1_700_000_000",
        '{"event":"package.published"}',
    );

    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(signature).not.toBe(
        webhookSignature(
            "secret",
            "1_700_000_001",
            '{"event":"package.published"}',
        ),
    );
});
