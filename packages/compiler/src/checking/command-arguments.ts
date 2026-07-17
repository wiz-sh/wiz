import type { CommandArgument } from "../ast/source-file.ts";

function isRedirection(value: string): boolean {
    return /^\d*(?:>|>>|<|<>|>&|<&)$/u.test(value);
}

/** Removes shell redirections because they are syntax, not command arguments. */
export function commandArguments(
    argumentsList: readonly CommandArgument[],
): readonly CommandArgument[] {
    return argumentsList.filter((argument, index) => {
        const previous = argumentsList[index - 1]?.value ?? "";

        return !isRedirection(argument.value) && !isRedirection(previous);
    });
}
