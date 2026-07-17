import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { registryMain } from "../src/registry.ts";

const roots: string[] = [];

const originalConfig = process.env.WIZ_CONFIG;

afterEach(async () => {
    if (originalConfig === undefined) {
        delete process.env.WIZ_CONFIG;
    } else {
        process.env.WIZ_CONFIG = originalConfig;
    }

    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

test("registry commands add, authenticate, default, and remove aliases", async () => {
    const root = join(import.meta.dir, `.tmp-${crypto.randomUUID()}`);

    roots.push(root);

    const path = join(root, "wiz.json");

    process.env.WIZ_CONFIG = path;

    expect(
        await registryMain([
            "add",
            "internal",
            "https://packages.example.com/",
        ]),
    ).toBe(0);

    expect(
        await registryMain([
            "set-token",
            "internal",
            "--token",
            "test-token-value",
        ]),
    ).toBe(0);

    expect(await registryMain(["set-default", "internal"])).toBe(0);

    const configured = JSON.parse(await Bun.file(path).text()) as {
        defaultRegistry: string;
        registries: Record<string, { url: string; token?: string }>;
    };

    expect(configured.defaultRegistry).toBe("internal");

    expect(configured.registries.internal).toEqual({
        url: "https://packages.example.com",
        token: "test-token-value",
    });

    expect(await registryMain(["logout", "internal"])).toBe(0);

    expect(await registryMain(["remove", "internal"])).toBe(0);

    const removed = JSON.parse(await Bun.file(path).text()) as {
        defaultRegistry: string;
        registries: Record<string, unknown>;
    };

    expect(removed.defaultRegistry).toBe("official");

    expect(removed.registries.internal).toBeUndefined();
});
