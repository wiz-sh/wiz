import { expect, test } from "bun:test";
import { validateManifest } from "../../src/project/manifest.ts";

test("external values require objects", () => {
    expect(() => {
        return validateManifest(null);
    }).toThrow("JSON object");
});

test("commits resemble object ids", () => {
    const manifest = {
        name: "x",
        dependencies: {
            y: {
                repo: ".",
                commit: "no",
            },
        },
    };

    expect(() => {
        return validateManifest(manifest);
    }).toThrow("commit");
});
