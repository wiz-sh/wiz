import { errorMessage, WizError } from "./errors.ts";

export type JsonPrimitive = boolean | number | string | null;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

export function requireJsonObject(
    value: JsonValue | undefined,
    label: string,
): JsonObject {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new WizError(`${label} must be a JSON object`);
    }

    return value;
}

export function assertJsonKeys(
    value: JsonObject,
    allowed: readonly string[],
    label: string,
): void {
    const unsupportedKey = Object.keys(value).find((key) => {
        return !allowed.includes(key);
    });

    if (unsupportedKey !== undefined) {
        throw new WizError(`Unsupported ${label} property: ${unsupportedKey}`);
    }
}

function assertNoDuplicateKeys(text: string): void {
    let index = 0;

    function skipWhitespace(): void {
        while (/\s/.test(text[index] ?? "")) {
            index += 1;
        }
    }

    function parseString(): string {
        const start = index;

        index += 1;

        while (index < text.length) {
            const character = text[index];

            if (character === "\\") {
                index += 2;

                continue;
            }

            index += 1;

            if (character === '"') {
                break;
            }
        }

        const parsed: JsonValue = JSON.parse(text.slice(start, index));

        if (typeof parsed !== "string") {
            throw new WizError("Malformed JSON string");
        }

        return parsed;
    }

    function scanValue(): void {
        skipWhitespace();

        if (text[index] === "{") {
            scanObject();

            return;
        }

        if (text[index] === "[") {
            scanArray();

            return;
        }

        if (text[index] === '"') {
            parseString();

            return;
        }

        while (index < text.length && !/[\s,\]}]/.test(text[index] ?? "")) {
            index += 1;
        }
    }

    function scanObject(): void {
        index += 1;

        skipWhitespace();

        const keys = new Set<string>();

        while (text[index] !== "}") {
            const key = parseString();

            if (keys.has(key)) {
                throw new WizError(`Duplicate JSON key: ${key}`);
            }

            keys.add(key);

            skipWhitespace();

            index += 1;

            scanValue();

            skipWhitespace();

            if (text[index] === ",") {
                index += 1;

                skipWhitespace();
            }
        }

        index += 1;
    }

    function scanArray(): void {
        index += 1;

        skipWhitespace();

        while (text[index] !== "]") {
            scanValue();

            skipWhitespace();

            if (text[index] === ",") {
                index += 1;

                skipWhitespace();
            }
        }

        index += 1;
    }

    scanValue();
}

/** Parses external JSON while rejecting duplicate keys that JSON.parse would silently replace. */
export function parseJson(text: string, label: string): JsonValue {
    try {
        const parsed: JsonValue = JSON.parse(text);

        assertNoDuplicateKeys(text);

        return parsed;
    } catch (err) {
        if (err instanceof WizError) {
            throw err;
        }

        const message = err instanceof Error ? errorMessage(err) : String(err);

        throw new WizError(`Malformed ${label}: ${message}`);
    }
}

export function serializeJson(value: JsonValue): string {
    return `${JSON.stringify(value, null, 4)}\n`;
}
