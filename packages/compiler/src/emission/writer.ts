export class EmitWriter {
    private value = "";

    write(text: string): { start: number; end: number } {
        const start = this.value.length;

        this.value += text;

        return { start, end: this.value.length };
    }

    toString(): string {
        return this.value;
    }
}
