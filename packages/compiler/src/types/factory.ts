import type { WizType } from "./type.ts";
import type { PrimitiveTypeName } from "./type-kind.ts";

const primitives = new Set<PrimitiveTypeName>([
    "string",
    "int",
    "bool",
    "path",
    "file",
    "directory",
    "bytes",
    "status",
    "stream",
    "void",
    "any",
    "unknown",
    "never",
]);

export function parseType(text: string): WizType | undefined {
    const source = text.trim();

    const unionParts = source.split("|").map((part) => {
        return part.trim();
    });

    if (unionParts.length > 1) {
        const members = unionParts.map((part) => {
            return parseType(part);
        });

        if (
            members.some((member) => {
                return member === undefined;
            })
        ) {
            return undefined;
        }

        const resolved = members.filter((member): member is WizType => {
            return member !== undefined;
        });

        return {
            kind: "union",
            name: resolved
                .map((member) => {
                    return member.name;
                })
                .join(" | "),
            members: resolved,
        };
    }

    if (
        source.length >= 2 &&
        ((source.startsWith('"') && source.endsWith('"')) ||
            (source.startsWith("'") && source.endsWith("'")))
    ) {
        const literal = source.slice(1, -1);

        return {
            kind: "literal",
            name: JSON.stringify(literal),
            literal,
        };
    }

    if (source.endsWith("?")) {
        const element = parseType(source.slice(0, -1));

        return element === undefined
            ? undefined
            : { kind: "optional", name: `${element.name}?`, element };
    }

    if (source.endsWith("[]")) {
        const element = parseType(source.slice(0, -2));

        return element === undefined
            ? undefined
            : { kind: "array", name: `${element.name}[]`, element };
    }

    if (source.startsWith("map<") && source.endsWith(">")) {
        const parts = source
            .slice(4, -1)
            .split(",")
            .map((part) => {
                return part.trim();
            });

        if (parts.length !== 2) {
            return undefined;
        }

        const key = parseType(parts[0] ?? "");

        const value = parseType(parts[1] ?? "");

        if (key === undefined || value === undefined || key.name !== "string") {
            return undefined;
        }

        return {
            kind: "map",
            name: `map<${key.name}, ${value.name}>`,
            key,
            value,
        };
    }

    if (!primitives.has(source as PrimitiveTypeName)) {
        return undefined;
    }

    return {
        kind: "primitive",
        name: source,
        primitive: source as PrimitiveTypeName,
    };
}

export function requiredType(text: string): WizType {
    return (
        parseType(text) ?? {
            kind: "primitive",
            name: "unknown",
            primitive: "unknown",
        }
    );
}
