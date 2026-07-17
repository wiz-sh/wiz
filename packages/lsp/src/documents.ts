export interface Position {
    line: number;
    character: number;
}

export interface Range {
    start: Position;
    end: Position;
}

export function offsetAt(text: string, position: Position): number {
    let offset = 0;

    let line = 0;

    while (line < position.line && offset < text.length) {
        const next = text.indexOf("\n", offset);

        if (next < 0) {
            return text.length;
        }

        offset = next + 1;

        line += 1;
    }

    return Math.min(text.length, offset + position.character);
}

export function positionAt(text: string, offset: number): Position {
    const bounded = Math.max(0, Math.min(offset, text.length));

    let line = 0;

    let lineStart = 0;

    for (let index = 0; index < bounded; index += 1) {
        if (text[index] === "\n") {
            line += 1;

            lineStart = index + 1;
        }
    }

    return { line, character: bounded - lineStart };
}

export function rangeAt(
    text: string,
    range: { start: number; end: number },
): Range {
    return {
        start: positionAt(text, range.start),
        end: positionAt(text, range.end),
    };
}
