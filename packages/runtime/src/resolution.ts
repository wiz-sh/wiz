import { WizError } from "@wiz/pm";

/** Resolves an executable using the current process PATH. */
export function resolveSystemExecutable(binary: string): string | undefined {
    if (binary.length === 0 || binary.includes("\0")) {
        return undefined;
    }

    return Bun.which(binary) ?? undefined;
}

/** Requires an executable and returns its resolved path for callers that need it. */
export function needs(binary: string): string {
    const path = resolveSystemExecutable(binary);

    if (path === undefined) {
        throw new WizError(`Required binary is not installed: ${binary}`);
    }

    return path;
}
