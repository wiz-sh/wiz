import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse } from "node:path";
import { WizError } from "../utils/errors.ts";

export function wizHome(
    env: Readonly<Record<string, string | undefined>> = process.env,
): string {
    return env.WIZ_HOME ?? join(env.HOME ?? homedir(), ".wiz");
}

export async function findProjectRootIfPresent(
    start = process.cwd(),
): Promise<string | undefined> {
    let current = start;

    while (true) {
        try {
            await access(join(current, "manifest.json"));

            return current;
        } catch {
            const parent = dirname(current);

            if (parent === current || current === parse(current).root) {
                return undefined;
            }

            current = parent;
        }
    }
}

export async function findProjectRoot(start = process.cwd()): Promise<string> {
    const root = await findProjectRootIfPresent(start);

    if (root === undefined) {
        throw new WizError(
            "No manifest.json found in this directory or its parents",
        );
    }

    return root;
}
