import { expect, test } from "bun:test";
import schema from "../../schemas/manifest.schema.json";
import {
    MANIFEST_SCHEMA_URL,
    parseManifest,
    serializeManifest,
} from "../../src/project/manifest.ts";

test("the public manifest schema describes the generated package-style shape", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");

    expect(schema.$id).toBe(MANIFEST_SCHEMA_URL);

    expect(schema.required).toEqual(["name"]);

    expect(schema.properties).toEqual(
        expect.objectContaining({
            name: expect.any(Object),
            main: expect.any(Object),
            scripts: expect.any(Object),
            bin: expect.any(Object),
            dependencies: expect.any(Object),
            workspaces: expect.any(Object),
        }),
    );

    expect(schema.properties).not.toHaveProperty("manifestVersion");

    expect(schema.properties).not.toHaveProperty("package");
});

test("serialized manifests reference the schema and round trip", () => {
    const manifest = parseManifest(
        JSON.stringify({
            name: "schema-example",
            version: "1.0.0",
            main: "src/index.sh",
            scripts: { check: "bash -n src/index.sh" },
        }),
    );

    const serialized = serializeManifest(manifest);

    const json = JSON.parse(serialized) as Record<string, unknown>;

    expect(json.$schema).toBe(MANIFEST_SCHEMA_URL);

    expect(json.name).toBe("schema-example");

    expect(json.main).toBe("src/index.sh");

    expect(json.manifestVersion).toBeUndefined();

    expect(json.package).toBeUndefined();

    expect(parseManifest(serialized)).toEqual(manifest);
});
