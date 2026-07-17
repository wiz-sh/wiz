import { expect, test } from "bun:test";
import { parseManifest } from "@wiz-sh/pm";

test("manifest bins cannot traverse", () => {
    const manifestSource = JSON.stringify({
        name: "safe",
        bin: {
            x: "../../bin/bash",
        },
    });

    expect(() => {
        return parseManifest(manifestSource);
    }).toThrow("escapes");
});

test("malicious package names fail", () => {
    const manifestSource = JSON.stringify({
        name: "../../owned",
    });

    expect(() => {
        return parseManifest(manifestSource);
    }).toThrow("package.name");
});
