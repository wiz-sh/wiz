import { describe, expect, test } from "bun:test";
import {
    parseManifest,
    serializeManifest,
} from "../../src/project/manifest.ts";
import type { JsonObject, JsonValue } from "../../src/utils/json.ts";

const source = (value: JsonValue): string => {
    return JSON.stringify(value);
};

const minimal = (packageValue: JsonObject = { name: "x" }): JsonObject => {
    return packageValue;
};

describe("manifest parsing", () => {
    test("minimal manifest", () => {
        const manifestSource = source(
            minimal({
                name: "demo",
            }),
        );

        const parsed = parseManifest(manifestSource);

        expect(parsed).toEqual({
            package: {
                name: "demo",
            },
            scripts: {},
            bins: {},
            dependencies: {},
        });
    });

    test("full manifest", () => {
        const manifestSource = source({
            ...minimal({
                name: "demo",
                main: "src/main.sh",
            }),
            scripts: {
                test: "echo ok",
            },
            bin: {
                demo: "bin/demo",
            },
            dependencies: {
                dep: {
                    repo: "./dep",
                    branch: "main",
                },
            },
        });

        const parsed = parseManifest(manifestSource);

        expect(parsed).toMatchObject({
            package: {
                name: "demo",
                index: "src/main.sh",
            },
            dependencies: {
                dep: {
                    repo: "./dep",
                    branch: "main",
                },
            },
        });
    });

    test("workspace manifests and local dependencies round trip", () => {
        const parsed = parseManifest(
            source({
                ...minimal({ name: "suite", private: true }),
                workspaces: ["packages/*", "apps/*"],
                dependencies: {
                    shared: { workspace: "*" },
                },
            }),
        );

        expect(parsed.workspaces).toEqual(["packages/*", "apps/*"]);

        expect(parsed.dependencies.shared).toEqual({ workspace: "*" });

        expect(parseManifest(serializeManifest(parsed))).toEqual(parsed);
    });

    test("workspace paths and dependency shapes are validated", () => {
        expect(() => {
            parseManifest(
                source({
                    ...minimal(),
                    workspaces: ["../outside"],
                }),
            );
        }).toThrow("must stay within");

        expect(() => {
            parseManifest(
                source({
                    ...minimal(),
                    dependencies: {
                        shared: {
                            workspace: "*",
                            repo: "./shared",
                        },
                    },
                }),
            );
        }).toThrow("cannot also declare Git fields");
    });

    test("package metadata round trips", () => {
        const manifestSource = source(
            minimal({
                name: "demo",
                version: "2.1.0",
                description: "A useful shell package",
                license: "MIT",
                author: {
                    name: "Hazel",
                    email: "hazel@example.com",
                    url: "https://example.com/hazel",
                },
                contributors: [
                    {
                        name: "Sky",
                        email: "sky@example.com",
                        url: "https://example.com/sky",
                    },
                ],
                contact: "maintainers@example.com",
                repository: "https://example.com/demo.git",
                homepage: "https://example.com/demo",
                bugs: {
                    url: "https://example.com/demo/issues",
                    email: "bugs@example.com",
                },
                keywords: ["shell", "bash"],
                funding: ["https://example.com/sponsor"],
                private: false,
                links: {
                    documentation: "https://example.com/demo/docs",
                    changelog: "https://example.com/demo/changelog",
                },
            }),
        );

        const parsed = parseManifest(manifestSource);

        const serialized = serializeManifest(parsed);

        expect(serialized).toContain('"dependencies": {}');

        expect(parseManifest(serialized)).toEqual(parsed);

        expect(parsed.package.author?.name).toBe("Hazel");

        expect(parsed.package.version).toBe("2.1.0");

        expect(parsed.package.links?.documentation).toBe(
            "https://example.com/demo/docs",
        );
    });

    for (const [label, value] of [
        ["version", { name: "x", version: 2 }],
        ["name", minimal({ name: "Bad Name" })],
        ["absolute", minimal({ name: "x", main: "/etc/passwd" })],
        ["traversal", minimal({ name: "x", main: "../x" })],
        [
            "bin",
            {
                ...minimal(),
                bin: {
                    "bad/name": "x",
                },
            },
        ],
        [
            "dependency",
            {
                ...minimal(),
                dependencies: {
                    y: {
                        repo: 3,
                    },
                },
            },
        ],
        [
            "unsupported property",
            {
                ...minimal(),
                wat: 2,
            },
        ],
        [
            "empty script",
            {
                ...minimal(),
                scripts: {
                    x: "",
                },
            },
        ],
        [
            "metadata URL",
            minimal({
                name: "x",
                homepage: "javascript:alert(1)",
            }),
        ],
        [
            "author email",
            minimal({
                name: "x",
                author: {
                    name: "X",
                    email: "bad",
                },
            }),
        ],
    ] as const) {
        test(`rejects ${label}`, () => {
            expect(() => {
                return parseManifest(source(value));
            }).toThrow();
        });
    }

    test("duplicate keys are malformed", () => {
        const manifestSource = '{"name":"x","name":"x"}';

        expect(() => {
            return parseManifest(manifestSource);
        }).toThrow("Duplicate");
    });

    test("legacy versioned manifests remain readable", () => {
        const parsed = parseManifest(
            source({
                manifestVersion: 1,
                package: {
                    name: "legacy",
                    index: "src/index.sh",
                },
            }),
        );

        expect(parsed.package).toEqual({
            name: "legacy",
            index: "src/index.sh",
        });

        const migrated = serializeManifest(parsed);

        expect(migrated).toContain('"name": "legacy"');

        expect(migrated).toContain('"main": "src/index.sh"');

        expect(migrated).not.toContain("manifestVersion");
    });

    test("unsupported legacy manifest versions remain rejected", () => {
        expect(() => {
            parseManifest(
                source({
                    manifestVersion: 2,
                    package: { name: "legacy" },
                }),
            );
        }).toThrow("legacy manifestVersion");
    });
});
