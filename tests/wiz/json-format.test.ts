import { afterEach, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatJson, formatRepositoryJson } from "../../tools/json-format.ts";
import { temporaryDirectory } from "../utils/filesystem.ts";

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

test("canonical JSON uses four spaces and one trailing newline", () => {
    expect(formatJson('{"nested":{"items":[1,2]}}')).toBe(`{
    "nested": {
        "items": [
            1,
            2
        ]
    }
}
`);
});

test("repository JSON formatting checks and rewrites owned files", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    await mkdir(join(root, "node_modules", "generated"), { recursive: true });

    await writeFile(join(root, "config.json"), '{"enabled":true}');

    await writeFile(
        join(root, "node_modules", "generated", "package.json"),
        '{"minified":true}',
    );

    const before = await formatRepositoryJson(root, true);

    expect(before.changed).toEqual(["config.json"]);

    await formatRepositoryJson(root, false);

    const after = await formatRepositoryJson(root, true);

    expect(after.checked).toBe(1);

    expect(after.changed).toEqual([]);
});
