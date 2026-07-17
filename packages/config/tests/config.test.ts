import { afterEach, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { discoverConfig, loadConfig } from "../src/index.ts";

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

test("configuration is discovered upward, merged, validated and normalized", async () => {
    const root = join(import.meta.dir, `.tmp-${crypto.randomUUID()}`);

    roots.push(root);

    await mkdir(join(root, "src", "nested"), { recursive: true });

    await writeFile(
        join(root, "config.wiz.json"),
        JSON.stringify({
            compiler: { runtimeChecks: "all" },
            formatter: { indentWidth: 2 },
        }),
    );

    expect(await discoverConfig(join(root, "src", "nested"))).toBe(
        join(root, "config.wiz.json"),
    );

    const loaded = await loadConfig(join(root, "src", "nested"));

    expect(loaded.diagnostics).toEqual([]);

    expect(loaded.config.compiler.runtimeChecks).toBe("all");

    expect(loaded.config.compiler.rootDir).toBe(join(root, "src"));

    expect(loaded.config.formatter.indentWidth).toBe(2);
});

test("configuration reports unknown keys", async () => {
    const root = join(import.meta.dir, `.tmp-${crypto.randomUUID()}`);

    roots.push(root);

    await mkdir(root, { recursive: true });

    await writeFile(
        join(root, "config.wiz.json"),
        '{"compiler":{"future":true}}',
    );

    const loaded = await loadConfig(root);

    expect(loaded.diagnostics).toContainEqual(
        expect.objectContaining({ code: "WIZCFG001", path: "compiler.future" }),
    );
});

test("configuration validates values before merging them into defaults", async () => {
    const root = join(import.meta.dir, `.tmp-${crypto.randomUUID()}`);

    roots.push(root);

    await mkdir(root, { recursive: true });

    await writeFile(
        join(root, "config.wiz.json"),
        JSON.stringify({
            compiler: {
                target: "fish",
                sourceMap: "yes",
            },
            formatter: {
                indentWidth: 0,
            },
            linter: {
                rules: {
                    "safety/no-eval": "sometimes",
                },
            },
            files: {
                include: ["src/**/*.wiz", 42],
            },
        }),
    );

    const loaded = await loadConfig(root);

    expect(
        loaded.diagnostics.map((diagnostic) => {
            return diagnostic.path;
        }),
    ).toEqual(
        expect.arrayContaining([
            "compiler.sourceMap",
            "formatter.indentWidth",
            "linter.rules.safety/no-eval",
            "files.include",
        ]),
    );

    // Invalid files are rejected atomically, so a valid sibling cannot mask errors.
    expect(loaded.config.compiler.target).toBe("bash");

    expect(loaded.config.formatter.indentWidth).toBe(4);
});

test("inherited compiler paths resolve beside the config that declares them", async () => {
    const root = join(import.meta.dir, `.tmp-${crypto.randomUUID()}`);

    const shared = join(root, "config");

    const project = join(root, "project");

    roots.push(root);

    await mkdir(shared, { recursive: true });

    await mkdir(project, { recursive: true });

    await writeFile(
        join(shared, "base.json"),
        JSON.stringify({
            compiler: {
                rootDir: "./sources",
                outDir: "./output",
            },
        }),
    );

    await writeFile(
        join(project, "config.wiz.json"),
        JSON.stringify({ extends: "../config/base.json" }),
    );

    const loaded = await loadConfig(project);

    expect(loaded.diagnostics).toEqual([]);

    expect(loaded.config.compiler.rootDir).toBe(join(shared, "sources"));

    expect(loaded.config.compiler.outDir).toBe(join(shared, "output"));
});

test("configuration inheritance cycles are diagnosed", async () => {
    const root = join(import.meta.dir, `.tmp-${crypto.randomUUID()}`);

    roots.push(root);

    await mkdir(root, { recursive: true });

    await writeFile(
        join(root, "config.wiz.json"),
        JSON.stringify({ extends: "./base.json" }),
    );

    await writeFile(
        join(root, "base.json"),
        JSON.stringify({ extends: "./config.wiz.json" }),
    );

    const loaded = await loadConfig(root);

    expect(loaded.diagnostics).toContainEqual(
        expect.objectContaining({ code: "WIZCFG005" }),
    );
});
