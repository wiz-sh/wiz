import type { WizSymbol } from "./symbol.ts";

/** A lexical shell scope with parent lookup for globals and captured values. */
export class Scope {
    readonly parent: Scope | undefined;
    readonly symbols = new Map<string, WizSymbol>();

    constructor(parent?: Scope) {
        this.parent = parent;
    }

    resolve(name: string): WizSymbol | undefined {
        return this.symbols.get(name) ?? this.parent?.resolve(name);
    }
}
