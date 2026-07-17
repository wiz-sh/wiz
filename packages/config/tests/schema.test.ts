import { expect, test } from "bun:test";
import schema from "../schemas/config.wiz.schema.json";

test("published schema covers compiler and tooling sections", () => {
    expect(schema.properties).toEqual(
        expect.objectContaining({
            compiler: expect.any(Object),
            typeChecking: expect.any(Object),
            formatter: expect.any(Object),
            linter: expect.any(Object),
            files: expect.any(Object),
        }),
    );

    expect(schema.properties.compiler.properties).toEqual(
        expect.objectContaining({
            bundle: { type: "boolean" },
            minify: { type: "boolean" },
        }),
    );
});
