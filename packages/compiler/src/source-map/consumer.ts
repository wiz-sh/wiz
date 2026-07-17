import type {
    SourceMapEntry,
    SourceMapPosition,
    WizSourceMap,
} from "./types.ts";

function nearest(
    entries: readonly SourceMapEntry[],
    offset: number,
    side: "source" | "generated",
): SourceMapEntry | undefined {
    return (
        entries.find((entry) => {
            return (
                offset >= entry[side].start.offset &&
                offset <= entry[side].end.offset
            );
        }) ??
        entries.toSorted((left, right) => {
            return (
                Math.abs(left[side].start.offset - offset) -
                Math.abs(right[side].start.offset - offset)
            );
        })[0]
    );
}

export function loadSourceMap(text: string): WizSourceMap {
    const value: unknown = JSON.parse(text);

    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Wiz source map must be a JSON object");
    }

    const map = value as Record<string, unknown>;

    if (
        map.version !== 1 ||
        typeof map.compilerVersion !== "string" ||
        typeof map.sourceFile !== "string" ||
        typeof map.generatedFile !== "string" ||
        !Array.isArray(map.mappings)
    ) {
        throw new Error("Invalid or unsupported Wiz source map header");
    }

    const mappings = map.mappings.map((entry, index) => {
        return sourceMapEntry(entry, index);
    });

    return {
        version: 1,
        compilerVersion: map.compilerVersion,
        sourceFile: map.sourceFile,
        generatedFile: map.generatedFile,
        mappings,
    };
}

function position(value: unknown, label: string): SourceMapPosition {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }

    const data = value as Record<string, unknown>;

    if (
        !Number.isInteger(data.line) ||
        !Number.isInteger(data.column) ||
        !Number.isInteger(data.offset) ||
        Number(data.line) < 0 ||
        Number(data.column) < 0 ||
        Number(data.offset) < 0
    ) {
        throw new Error(`${label} must contain non-negative integer positions`);
    }

    return {
        line: Number(data.line),
        column: Number(data.column),
        offset: Number(data.offset),
    };
}

function sourceMapEntry(value: unknown, index: number): SourceMapEntry {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`mappings[${index}] must be an object`);
    }

    const data = value as Record<string, unknown>;

    const source = range(data.source, `mappings[${index}].source`);

    const generated = range(data.generated, `mappings[${index}].generated`);

    if (data.name !== undefined && typeof data.name !== "string") {
        throw new Error(`mappings[${index}].name must be a string`);
    }

    return {
        source,
        generated,
        ...(typeof data.name === "string" ? { name: data.name } : {}),
    };
}

function range(
    value: unknown,
    label: string,
): { start: SourceMapPosition; end: SourceMapPosition } {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }

    const data = value as Record<string, unknown>;

    const start = position(data.start, `${label}.start`);

    const end = position(data.end, `${label}.end`);

    if (end.offset < start.offset) {
        throw new Error(`${label} ends before it starts`);
    }

    return { start, end };
}

export function mapGeneratedToSource(
    map: WizSourceMap,
    offset: number,
): SourceMapPosition | undefined {
    return nearest(map.mappings, offset, "generated")?.source.start;
}

export function mapSourceToGenerated(
    map: WizSourceMap,
    offset: number,
): SourceMapPosition | undefined {
    return nearest(map.mappings, offset, "source")?.generated.start;
}
