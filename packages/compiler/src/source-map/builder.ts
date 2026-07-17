import type { SourceText } from "../syntax/source-text.ts";
import type { TextRange } from "../syntax/text-range.ts";
import type {
    SourceMapEntry,
    SourceMapPosition,
    WizSourceMap,
} from "./types.ts";

function generatedPosition(text: string, offset: number): SourceMapPosition {
    const before = text.slice(0, offset);

    const lines = before.split("\n");

    return {
        line: lines.length - 1,
        column: (lines.at(-1) ?? "").length,
        offset,
    };
}

/** Incrementally records half-open source and generated ranges. */
export class SourceMapBuilder {
    private readonly entries: SourceMapEntry[] = [];
    private readonly source: SourceText;
    private readonly sourceFile: string;
    private readonly generatedFile: string;

    constructor(
        source: SourceText,
        generatedFile: string,
        sourceFile = source.fileName,
    ) {
        this.source = source;

        this.sourceFile = sourceFile;

        this.generatedFile = generatedFile;
    }

    add(
        sourceRange: TextRange,
        generatedRange: TextRange,
        generatedText: string,
        name?: string,
    ): void {
        const sourceStart = this.source.positionAt(sourceRange.start);

        const sourceEnd = this.source.positionAt(sourceRange.end);

        this.entries.push({
            source: { start: sourceStart, end: sourceEnd },
            generated: {
                start: generatedPosition(generatedText, generatedRange.start),
                end: generatedPosition(generatedText, generatedRange.end),
            },
            ...(name === undefined ? {} : { name }),
        });
    }

    build(): WizSourceMap {
        return {
            version: 1,
            compilerVersion: "0.1.0",
            sourceFile: this.sourceFile,
            generatedFile: this.generatedFile,
            mappings: this.entries,
        };
    }
}
