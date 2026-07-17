import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { temporaryDirectory } from "../../../tests/utils/filesystem.ts";
import { manifest } from "../../../tests/utils/fixtures.ts";
import { createRepository } from "../../../tests/utils/git.ts";
import { resolveDependencies } from "../src/dependencies/resolver.ts";
import { parseManifest } from "../src/project/manifest.ts";

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

test("resolves direct and transitive dependencies", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    const leaf = join(root, "leaf");

    await createRepository(leaf, manifest("leaf"));

    const middle = join(root, "middle");

    await createRepository(
        middle,
        manifest("middle", {
            dependencies: {
                leaf: {
                    repo: leaf,
                },
            },
        }),
    );

    const project = parseManifest(
        manifest("project", {
            dependencies: {
                middle: {
                    repo: middle,
                },
            },
        }),
        root,
    );

    const lock = await resolveDependencies(project, {
        home: join(root, "home"),
        baseDirectory: root,
    });

    const packageNames = lock.packages
        .map((item) => {
            return item.name;
        })
        .sort();

    const leafPackage = lock.packages.find((item) => {
        return item.name === "leaf";
    });

    expect(packageNames).toEqual(["leaf", "middle"]);

    expect(leafPackage?.direct).toBe(false);
});

test("detects cycles", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    const a = join(root, "a");

    const b = join(root, "b");

    await createRepository(
        a,
        manifest("a", {
            dependencies: {
                b: {
                    repo: b,
                },
            },
        }),
    );

    await createRepository(
        b,
        manifest("b", {
            dependencies: {
                a: {
                    repo: a,
                },
            },
        }),
    );

    const project = parseManifest(
        manifest("p", {
            dependencies: {
                a: {
                    repo: a,
                },
            },
        }),
        root,
    );

    expect(
        resolveDependencies(project, {
            home: join(root, "home"),
            baseDirectory: root,
        }),
    ).rejects.toThrow("a -> b -> a");
});
