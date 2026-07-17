export interface SourceMapPosition {
    line: number;
    column: number;
    offset: number;
}

export interface SourceMapEntry {
    source: { start: SourceMapPosition; end: SourceMapPosition };
    generated: { start: SourceMapPosition; end: SourceMapPosition };
    name?: string;
}

export interface WizSourceMap {
    version: 1;
    compilerVersion: string;
    sourceFile: string;
    generatedFile: string;
    mappings: readonly SourceMapEntry[];
}
