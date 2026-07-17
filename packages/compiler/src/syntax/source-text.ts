import type { TextPosition } from "./text-range.ts";

export class SourceText {
    readonly text: string;
    readonly fileName: string;
    readonly lineStarts: readonly number[];

    constructor(text: string, fileName = "source.wiz") {
        this.text = text;

        this.fileName = fileName;

        const starts = [0];

        for (let index = 0; index < text.length; index += 1) {
            if (text.charCodeAt(index) === 10) {
                starts.push(index + 1);
            }
        }

        this.lineStarts = starts;
    }

    positionAt(offset: number): TextPosition {
        const bounded = Math.max(0, Math.min(offset, this.text.length));

        let low = 0;

        let high = this.lineStarts.length;

        while (low < high) {
            const middle = Math.floor((low + high) / 2);

            if ((this.lineStarts[middle] ?? 0) > bounded) {
                high = middle;
            } else {
                low = middle + 1;
            }
        }

        const line = Math.max(0, low - 1);

        return {
            line,
            column: bounded - (this.lineStarts[line] ?? 0),
            offset: bounded,
        };
    }

    offsetAt(line: number, column: number): number {
        const start =
            this.lineStarts[
                Math.max(0, Math.min(line, this.lineStarts.length - 1))
            ] ?? 0;

        return Math.min(this.text.length, start + Math.max(0, column));
    }
}
