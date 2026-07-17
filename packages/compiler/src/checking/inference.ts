import type { SourceFile, Statement } from "../ast/source-file.ts";
import type { Scope } from "../binding/scope.ts";
import { DiagnosticCodes } from "../diagnostics/codes.ts";
import type { Diagnostic } from "../diagnostics/diagnostic.ts";
import { isAssignable } from "../types/assignability.ts";
import { requiredType } from "../types/factory.ts";
import type { WizType } from "../types/type.ts";

/** Infers a shell argument without evaluating it or changing quoting semantics. */
export function inferArgument(
    value: string,
    scope?: Scope,
    preserveLiteral = false,
): WizType {
    const unquoted = value.replace(/^(['"])([\s\S]*)\1$/, "$2");

    const variable = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(unquoted);

    if (variable !== null) {
        return (
            scope?.resolve(variable[1] ?? "")?.type ?? requiredType("unknown")
        );
    }

    const lengthExpansion = /^\$\{#([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(unquoted);

    if (lengthExpansion !== null) {
        return requiredType("int");
    }

    const transformedExpansion =
        /^\$\{([A-Za-z_][A-Za-z0-9_]*)(\[@\]|\[\*\])?(?:(?::[-+=?]|[#%]{1,2})[\s\S]*)?\}$/.exec(
            unquoted,
        );

    if (transformedExpansion !== null) {
        const type =
            scope?.resolve(transformedExpansion[1] ?? "")?.type ??
            requiredType("unknown");

        if (transformedExpansion[2] !== undefined && type.kind === "array") {
            return type.element ?? requiredType("unknown");
        }

        return type;
    }

    if (unquoted === "$?") {
        return requiredType("status");
    }

    if (/^(?:\/|\.\.?\/|~\/)/.test(unquoted)) {
        return requiredType("path");
    }

    if (/^-?[0-9]+$/.test(unquoted)) {
        return requiredType("int");
    }

    if (unquoted === "true" || unquoted === "false") {
        return requiredType("bool");
    }

    const commandSubstitution = /^\$\(\s*([A-Za-z_][A-Za-z0-9_-]*)/.exec(
        unquoted,
    );

    if (commandSubstitution !== null) {
        const command = commandSubstitution[1] ?? "";

        return scope?.resolve(command)?.type ?? requiredType("string");
    }

    if (value.includes("$")) {
        return requiredType("unknown");
    }

    if (preserveLiteral) {
        return {
            kind: "literal",
            name: JSON.stringify(unquoted),
            literal: unquoted,
        };
    }

    return requiredType("string");
}

function collectionItems(initializer: string): string[] {
    const source = initializer.trim().slice(1, -1);

    const items: string[] = [];

    let start = 0;

    let depth = 0;

    let quote: string | undefined;

    for (let index = 0; index <= source.length; index += 1) {
        const character = source[index];

        if (quote !== undefined) {
            if (character === quote && source[index - 1] !== "\\") {
                quote = undefined;
            }

            continue;
        }

        if (character === "'" || character === '"') {
            quote = character;

            continue;
        }

        if (character === "(" || character === "{") {
            depth += 1;
        } else if (character === ")" || character === "}") {
            depth = Math.max(0, depth - 1);
        }

        if ((character === undefined || /\s/.test(character)) && depth === 0) {
            const item = source.slice(start, index).trim();

            if (item !== "") {
                items.push(item);
            }

            start = index + 1;
        }
    }

    return items;
}

/** Validates array and map literals separately from scalar assignments. */
export function checkCollectionInitializer(
    statement: Extract<Statement, { kind: "TypedVariableDeclaration" }>,
    file: SourceFile,
    scope: Scope,
    diagnostics: Diagnostic[],
): boolean {
    const initializer = statement.initializer?.trim();

    if (
        initializer === undefined ||
        !initializer.startsWith("(") ||
        !initializer.endsWith(")") ||
        (statement.type.kind !== "array" && statement.type.kind !== "map")
    ) {
        return false;
    }

    const expected =
        statement.type.kind === "array"
            ? statement.type.element
            : statement.type.value;

    if (expected === undefined) {
        return true;
    }

    for (const item of collectionItems(initializer)) {
        const equals = statement.type.kind === "map" ? item.indexOf("=") : -1;

        const value = equals < 0 ? item : item.slice(equals + 1);

        const actual = inferArgument(value, scope);

        if (actual.name === "unknown" || isAssignable(actual, expected)) {
            continue;
        }

        diagnostics.push({
            code: DiagnosticCodes.typeMismatch,
            message: `Collection ${statement.name ?? "value"} expects ${expected.name} elements, but received ${actual.name}`,
            severity: "error",
            phase: "type",
            fileName: file.fileName,
            range: statement.range,
        });
    }

    return true;
}
