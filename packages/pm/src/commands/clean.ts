import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { parse, resolve } from "node:path";
import { wizHome } from "../project/discovery.ts";
import { WizError } from "../utils/errors.ts";

export function cleanTarget(): string {
    return resolve(wizHome());
}

/** Removes Wiz-managed state while protecting paths that can never be valid Wiz homes. */
export async function clean(): Promise<void> {
    const target = cleanTarget();

    const filesystemRoot = parse(target).root;

    const userHome = resolve(homedir());

    if (target === filesystemRoot || target === userHome) {
        throw new WizError(`Refusing to clean unsafe WIZ_HOME: ${target}`);
    }

    await rm(target, {
        recursive: true,
        force: true,
    });
}
