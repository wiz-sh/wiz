import { RegistryError } from "./errors.ts";
import type { RegistryRequestOptions } from "./types.ts";

interface ErrorEnvelope {
    error?: {
        code?: string;
        message?: string;
        status?: number;
        requestId?: string;
        details?: unknown;
    };
}

export interface RegistryTransportOptions {
    baseUrl: string;
    token?: string;
    timeoutMs?: number;
    retries?: number;
    userAgent?: string;
    fetch?: typeof fetch;
}

export interface TransportRequest extends RegistryRequestOptions {
    method?: string;
    path: string;
    body?: unknown;
    headers?: HeadersInit;
    response?: "json" | "bytes" | "response";
}

function retryable(method: string, status: number): boolean {
    return (
        ["GET", "HEAD", "OPTIONS"].includes(method) &&
        (status === 408 || status === 429 || status >= 500)
    );
}

async function errorFromResponse(response: Response): Promise<RegistryError> {
    let envelope: ErrorEnvelope = {};

    try {
        envelope = (await response.json()) as ErrorEnvelope;
    } catch {
        // Non-JSON proxy errors still become the stable public error type.
    }

    const value = envelope.error;

    const requestId =
        value?.requestId ?? response.headers.get("x-request-id") ?? undefined;

    return new RegistryError(
        value?.message ??
            `Registry request failed with status ${response.status}`,
        {
            code: value?.code ?? "REGISTRY_REQUEST_FAILED",
            status: value?.status ?? response.status,
            ...(requestId === undefined ? {} : { requestId }),
            ...(value?.details === undefined ? {} : { details: value.details }),
        },
    );
}

/** HTTP boundary with bounded retries, cancellation, timeouts, and structured failures. */
export class RegistryTransport {
    private readonly options: Required<
        Pick<RegistryTransportOptions, "timeoutMs" | "retries" | "userAgent">
    > &
        RegistryTransportOptions;

    constructor(options: RegistryTransportOptions) {
        this.options = {
            timeoutMs: 15_000,
            retries: 2,
            userAgent: "wiz/0.1.0",
            ...options,
            baseUrl: options.baseUrl.replace(/\/$/, ""),
        };
    }

    async request<T>(request: TransportRequest): Promise<T> {
        const method = request.method?.toUpperCase() ?? "GET";

        let lastError: unknown;

        for (let attempt = 0; attempt <= this.options.retries; attempt += 1) {
            const controller = new AbortController();

            const timeout = setTimeout(() => {
                controller.abort(new Error("Registry request timed out"));
            }, this.options.timeoutMs);

            const abort = (): void => {
                controller.abort(request.signal?.reason);
            };

            request.signal?.addEventListener("abort", abort, { once: true });

            try {
                const headers = new Headers(request.headers);

                headers.set("accept", "application/json");

                headers.set("user-agent", this.options.userAgent);

                headers.set(
                    "x-request-id",
                    request.requestId ?? crypto.randomUUID(),
                );

                if (this.options.token !== undefined) {
                    headers.set(
                        "authorization",
                        `Bearer ${this.options.token}`,
                    );
                }

                if (request.idempotencyKey !== undefined) {
                    headers.set("idempotency-key", request.idempotencyKey);
                }

                if (
                    request.body !== undefined &&
                    !(request.body instanceof Blob)
                ) {
                    headers.set("content-type", "application/json");
                }

                const response = await (this.options.fetch ?? fetch)(
                    `${this.options.baseUrl}${request.path}`,
                    {
                        method,
                        headers,
                        signal: controller.signal,
                        ...(request.body === undefined
                            ? {}
                            : {
                                  body:
                                      request.body instanceof Blob
                                          ? request.body
                                          : JSON.stringify(request.body),
                              }),
                    },
                );

                if (!response.ok) {
                    const error = await errorFromResponse(response);

                    if (
                        attempt < this.options.retries &&
                        retryable(method, response.status)
                    ) {
                        lastError = error;

                        await Bun.sleep(50 * 2 ** attempt);

                        continue;
                    }

                    throw error;
                }

                if (request.response === "response") {
                    return response as T;
                }

                if (request.response === "bytes") {
                    return new Uint8Array(await response.arrayBuffer()) as T;
                }

                if (response.status === 204) {
                    return undefined as T;
                }

                return (await response.json()) as T;
            } catch (err) {
                if (err instanceof RegistryError) {
                    throw err;
                }

                lastError = err;

                if (
                    attempt >= this.options.retries ||
                    !["GET", "HEAD", "OPTIONS"].includes(method) ||
                    request.signal?.aborted === true
                ) {
                    throw new RegistryError("Unable to reach the registry", {
                        code:
                            controller.signal.aborted &&
                            request.signal?.aborted !== true
                                ? "REGISTRY_TIMEOUT"
                                : "REGISTRY_UNAVAILABLE",
                        status: 0,
                        cause: err,
                    });
                }

                await Bun.sleep(50 * 2 ** attempt);
            } finally {
                clearTimeout(timeout);

                request.signal?.removeEventListener("abort", abort);
            }
        }

        throw new RegistryError("Unable to reach the registry", {
            code: "REGISTRY_UNAVAILABLE",
            status: 0,
            cause: lastError,
        });
    }
}
