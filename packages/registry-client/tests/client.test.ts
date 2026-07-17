import { afterEach, expect, test } from "bun:test";
import { RegistryClient } from "../src/index.ts";

const servers: Bun.Server<unknown>[] = [];

afterEach(() => {
    for (const server of servers.splice(0)) {
        server.stop(true);
    }
});

test("client encodes scoped package paths and downloads exact bytes", async () => {
    const archive = new Uint8Array([0, 1, 2, 255]);

    const requests: string[] = [];

    const server = Bun.serve({
        port: 0,
        fetch(request) {
            requests.push(new URL(request.url).pathname);

            return new Response(archive);
        },
    });

    servers.push(server);

    const client = new RegistryClient({ baseUrl: server.url.toString() });

    expect(await client.download("@wiz/compiler", "1.4.0")).toEqual(archive);

    expect(requests).toEqual([
        "/v1/packages/%40wiz%2Fcompiler/versions/1.4.0/archive",
    ]);
});

test("search exposes typed discovery filters and opaque pagination", async () => {
    let search: URL | undefined;

    const server = Bun.serve({
        port: 0,
        fetch(request) {
            search = new URL(request.url);

            return Response.json({ items: [], nextCursor: "cursor-2" });
        },
    });

    servers.push(server);

    const client = new RegistryClient({ baseUrl: server.url.toString() });

    await client.search({
        query: "compiler",
        scope: "@wiz",
        owner: "wiz",
        keyword: "shell",
        visibility: "public",
        sort: "recent",
        limit: 25,
        cursor: "cursor-1",
    });

    expect(search?.pathname).toBe("/v1/search");

    expect(Object.fromEntries(search?.searchParams ?? [])).toEqual({
        cursor: "cursor-1",
        keyword: "shell",
        limit: "25",
        owner: "wiz",
        q: "compiler",
        scope: "@wiz",
        sort: "recent",
        visibility: "public",
    });
});
