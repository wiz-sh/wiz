import { expect, test } from "bun:test";
import {
    compileSource,
    loadSourceMap,
    mapGeneratedToSource,
    mapSourceToGenerated,
} from "../src/index.ts";

test("repeated commands receive ordered bidirectional mappings", () => {
    const source = `printf '%s\\n' first
printf '%s\\n' second
`;

    const emitted = compileSource(source, "/project/src/repeated.wiz", {
        rootDir: "/project/src",
        outDir: "/project/dist",
        sourceMap: true,
    }).files[0];

    const map = loadSourceMap(emitted?.mapText ?? "");

    const first = map.mappings[0];

    const second = map.mappings[1];

    expect(first?.generated.start.offset).toBeLessThan(
        second?.generated.start.offset ?? 0,
    );

    expect(mapSourceToGenerated(map, source.indexOf("second"))?.offset).toBe(
        second?.generated.start.offset,
    );

    expect(
        mapGeneratedToSource(map, second?.generated.start.offset ?? 0)?.offset,
    ).toBe(second?.source.start.offset);
});

test("source map loading rejects unsupported and malformed data", () => {
    expect(() => {
        loadSourceMap('{"version":2}');
    }).toThrow("unsupported Wiz source map header");

    expect(() => {
        loadSourceMap(
            JSON.stringify({
                version: 1,
                compilerVersion: "0.1.0",
                sourceFile: "a.wiz",
                generatedFile: "a.sh",
                mappings: [
                    {
                        source: {
                            start: { line: 0, column: 0, offset: 2 },
                            end: { line: 0, column: 0, offset: 1 },
                        },
                        generated: {
                            start: { line: 0, column: 0, offset: 0 },
                            end: { line: 0, column: 0, offset: 1 },
                        },
                    },
                ],
            }),
        );
    }).toThrow("ends before it starts");
});
