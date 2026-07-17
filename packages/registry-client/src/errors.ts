/** Stable registry failure surfaced instead of transport-specific exceptions. */
export class RegistryError extends Error {
    readonly code: string;
    readonly status: number;
    readonly requestId?: string;
    readonly details?: unknown;

    constructor(
        message: string,
        options: {
            code: string;
            status: number;
            requestId?: string;
            details?: unknown;
            cause?: unknown;
        },
    ) {
        super(message, { cause: options.cause });

        this.name = "RegistryError";

        this.code = options.code;

        this.status = options.status;

        if (options.requestId !== undefined) {
            this.requestId = options.requestId;
        }

        if (options.details !== undefined) {
            this.details = options.details;
        }
    }
}
