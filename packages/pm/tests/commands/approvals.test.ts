import { afterEach, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { temporaryDirectory } from "../../../../tests/utils/filesystem.ts";
import {
    readScriptApprovals,
    writeScriptApprovals,
} from "../../src/project/approvals.ts";

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

test("approval files round trip exact package identities", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    const approvals = {
        approvalVersion: 1 as const,
        packages: {
            "builder@hash:commit": {
                repo: "https://example.com/builder.git",
                commit: "a".repeat(40),
            },
        },
    };

    await writeScriptApprovals(root, approvals);

    const savedApprovals = await readScriptApprovals(root);

    expect(savedApprovals).toEqual(approvals);
});

test("approval files reject malformed or unsupported data", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    const path = join(root, "wiz.approvals.json");

    const malformedApprovals = JSON.stringify({
        approvalVersion: 1,
        unsupported: true,
    });

    await writeFile(path, malformedApprovals);

    expect(readScriptApprovals(root)).rejects.toThrow(
        "Unsupported approval property",
    );
});
