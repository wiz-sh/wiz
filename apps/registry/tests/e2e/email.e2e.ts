import { afterAll, expect, test } from "bun:test";
import { loadRegistryConfig } from "../../src/config/environment.ts";
import { RegistryMailer } from "../../src/email/client.ts";
import { verificationEmail } from "../../src/email/templates.ts";

const mailer = new RegistryMailer(loadRegistryConfig().smtp);

afterAll(() => {
    mailer.close();
});

test("the configured SMTP service accepts a rendered registry email", async () => {
    await mailer.verify();

    const messageId = await mailer.send(
        verificationEmail(
            "test@wiz.local",
            "http://localhost:3000/verify?token=local-test",
        ),
    );

    expect(messageId.length).toBeGreaterThan(0);
});
