import nodemailer, { type Transporter } from "nodemailer";
import type { RegistryServerConfig } from "../config/types.ts";

export interface RegistryEmail {
    to: string;
    subject: string;
    text: string;
    html?: string;
}

/** Owns the SMTP lifecycle so workers can verify and close transports cleanly. */
export class RegistryMailer {
    readonly #from: string;
    readonly #transporter: Transporter;

    constructor(config: RegistryServerConfig["smtp"]) {
        this.#from = `"${config.fromName.replaceAll('"', "")}" <${config.fromAddress}>`;

        this.#transporter = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            requireTLS: config.requireTls,
            ...(config.username === undefined || config.password === undefined
                ? {}
                : {
                      auth: {
                          user: config.username,
                          pass: config.password,
                      },
                  }),
        });
    }

    /** Fails before startup when SMTP credentials or connectivity are invalid. */
    async verify(): Promise<void> {
        await this.#transporter.verify();
    }

    async send(message: RegistryEmail): Promise<string> {
        const result = await this.#transporter.sendMail({
            from: this.#from,
            to: message.to,
            subject: message.subject,
            text: message.text,
            ...(message.html === undefined ? {} : { html: message.html }),
        });

        return String(result.messageId);
    }

    close(): void {
        this.#transporter.close();
    }
}
