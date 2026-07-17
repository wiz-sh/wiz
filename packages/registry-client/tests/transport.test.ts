import { afterEach, expect, test } from "bun:test";
import { RegistryError, RegistryTransport } from "../src/index.ts";

const servers: Bun.Server<unknown>[] = [];

afterEach(() => {
    for (const server of servers.splice(0)) {
        server.stop(true);
    }
});

test("transport sends identity headers and maps structured errors", async () => {
    const server = Bun.serve({
        port: 0,
        fetch(request) {
            if (new URL(request.url).pathname === "/error") {
                return Response.json(
                    {
                        error: {
                            code: "PACKAGE_NOT_FOUND",
                            message: "Package was not found",
                            status: 404,
                            requestId: "req_error",
                        },
                    },
                    { status: 404 },
                );
            }

            return Response.json({
                authorization: request.headers.get("authorization"),
                requestId: request.headers.get("x-request-id"),
                userAgent: request.headers.get("user-agent"),
            });
        },
    });

    servers.push(server);

    const transport = new RegistryTransport({
        baseUrl: server.url.toString(),
        token: "wiz_pat_test",
        userAgent: "wiz-test",
    });

    expect(
        await transport.request<{
            authorization: string;
            requestId: string;
            userAgent: string;
        }>({ path: "/ok", requestId: "req_test" }),
    ).toEqual({
        authorization: "Bearer wiz_pat_test",
        requestId: "req_test",
        userAgent: "wiz-test",
    });

    try {
        await transport.request({ path: "/error" });

        throw new Error("Expected registry request to fail");
    } catch (err) {
        expect(err).toBeInstanceOf(RegistryError);

        expect(err).toEqual(
            expect.objectContaining({
                code: "PACKAGE_NOT_FOUND",
                status: 404,
                requestId: "req_error",
            }),
        );
    }
});

test("safe requests retry transient responses", async () => {
    let attempts = 0;

    const server = Bun.serve({
        port: 0,
        fetch() {
            attempts += 1;

            return attempts < 3
                ? Response.json({ unavailable: true }, { status: 503 })
                : Response.json({ ready: true });
        },
    });

    servers.push(server);

    const transport = new RegistryTransport({
        baseUrl: server.url.toString(),
        retries: 2,
    });

    expect(
        await transport.request<{ ready: boolean }>({ path: "/ready" }),
    ).toEqual({
        ready: true,
    });

    expect(attempts).toBe(3);
});
