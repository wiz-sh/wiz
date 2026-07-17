import type { TypedVariableDeclaration } from "../../ast/source-file.ts";
import {
    cmdAssignmentValue,
    type ForeignTarget,
    fishValue,
    powerShellValue,
} from "./syntax.ts";

/** Erases a typed declaration into the target's native variable form. */
export function foreignDeclaration(
    statement: TypedVariableDeclaration,
    target: ForeignTarget,
): string {
    const name = statement.name ?? "";

    const value = statement.initializer ?? "";

    if (target === "powershell") {
        return `$${name} = ${powerShellValue(value)}`;
    }

    if (target === "fish") {
        const global = statement.attributes.includes("x") ? "-gx " : "";

        return `set ${global}${name}${value === "" ? "" : ` ${fishValue(value)}`}`;
    }

    return `set "${name}=${cmdAssignmentValue(value)}"`;
}
