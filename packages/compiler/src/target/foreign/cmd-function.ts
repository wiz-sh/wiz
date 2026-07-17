import type { FunctionDeclaration } from "../../ast/source-file.ts";
import { cmdAssignmentValue } from "./syntax.ts";

function parameterBinding(
    statement: FunctionDeclaration,
    index: number,
): string {
    const parameter = statement.parameters[index];

    if (parameter === undefined) {
        return "";
    }

    const position = index + 1;

    const binding = `set "${parameter.name}=%~${position}"`;

    if (parameter.defaultValue === undefined) {
        return binding;
    }

    const defaultValue = cmdAssignmentValue(parameter.defaultValue);

    return `${binding}\nif not defined ${parameter.name} set "${parameter.name}=${defaultValue}"`;
}

/** Emits a callable batch label while allowing top-level execution to continue. */
export function cmdFunctionDeclaration(
    statement: FunctionDeclaration,
    body: string,
): string {
    const parameters = statement.parameters
        .map((_parameter, index) => {
            return parameterBinding(statement, index);
        })
        .filter((binding) => {
            return binding !== "";
        })
        .join("\n");

    const prefix = parameters === "" ? "" : `${parameters}\n`;

    return [
        `goto :__wiz_after_${statement.name}`,
        `:${statement.name}`,
        `${prefix}${body.trimEnd()}`,
        "exit /b !ERRORLEVEL!",
        `:__wiz_after_${statement.name}`,
    ].join("\n");
}
