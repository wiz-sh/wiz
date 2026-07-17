import { afterEach, expect, test } from "bun:test";
import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
    defaultUserRegistryConfig,
    loadUserRegistryConfig,
    normalizeRegistryUrl,
    saveUserRegistryConfig,
    selectRegistry,
} from "../src/index.ts";

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

test("registry URLs require HTTPS except for local development", () => {
    expect(normalizeRegistryUrl("https://packages.example.com/")).toBe(
        "https://packages.example.com",
    );

    expect(normalizeRegistryUrl("http://127.0.0.1:3000/")).toBe(
        "http://127.0.0.1:3000",
    );

    expect(() => {
        normalizeRegistryUrl("http://packages.example.com");
    }).toThrow("must use HTTPS");

    expect(() => {
        normalizeRegistryUrl("https://token@example.com");
    }).toThrow("cannot contain credentials");
});

test("registry selection obeys explicit, environment, project, scope, and default precedence", () => {
    const user = {
        defaultRegistry: "official",
        registries: {
            official: { url: "https://registry.wiz.sh", token: "stored" },
            internal: { url: "https://packages.example.com" },
        },
        scopes: {
            "@company": { registry: "internal" },
        },
    };

    expect(selectRegistry("@company/tool", user).name).toBe("internal");

    expect(
        selectRegistry("tool", user, {
            environment: {
                WIZ_REGISTRY: "internal",
                WIZ_TOKEN: "environment",
            },
        }),
    ).toEqual({
        name: "internal",
        url: "https://packages.example.com",
        token: "environment",
    });

    expect(
        selectRegistry("tool", user, {
            registry: "official",
            token: "explicit",
            environment: { WIZ_REGISTRY: "internal" },
        }).token,
    ).toBe("explicit");
});

test("user registry configuration is atomic, restricted, and round trips", async () => {
    const root = join(import.meta.dir, `.tmp-${crypto.randomUUID()}`);

    roots.push(root);

    const path = join(root, "config", "wiz.json");

    const config = defaultUserRegistryConfig();

    await saveUserRegistryConfig(config, path);

    expect(await loadUserRegistryConfig(path)).toEqual(config);

    expect((await readFile(path, "utf8")).endsWith("\n")).toBe(true);

    if (process.platform !== "win32") {
        expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
});
