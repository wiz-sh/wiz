import type { RegistryEmail } from "./client.ts";

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

/** Renders both accessible plain text and escaped HTML for verification mail. */
export function verificationEmail(
    recipient: string,
    verificationUrl: string,
): RegistryEmail {
    const safeUrl = escapeHtml(verificationUrl);

    return {
        to: recipient,
        subject: "Verify your Wiz Registry email",
        text: `Verify your Wiz Registry email by visiting:\n\n${verificationUrl}\n`,
        html: `<p>Verify your Wiz Registry email:</p><p><a href="${safeUrl}">${safeUrl}</a></p>`,
    };
}

export function passwordResetEmail(
    recipient: string,
    resetUrl: string,
): RegistryEmail {
    const safeUrl = escapeHtml(resetUrl);

    return {
        to: recipient,
        subject: "Reset your Wiz Registry password",
        text: `Reset your Wiz Registry password by visiting:\n\n${resetUrl}\n`,
        html: `<p>Reset your Wiz Registry password:</p><p><a href="${safeUrl}">${safeUrl}</a></p>`,
    };
}
