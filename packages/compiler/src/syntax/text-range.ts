export interface TextPosition {
    line: number;
    column: number;
    offset: number;
}

export interface TextRange {
    start: number;
    end: number;
}

export function containsOffset(range: TextRange, offset: number): boolean {
    return offset >= range.start && offset <= range.end;
}
