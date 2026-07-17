import { access, lstat, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { WizError } from "../utils/errors.ts";

export async function executableInside(
    root: string,
    relativePath: string,
): Promise<string> {
    const target = resolve(root, relativePath);

    const rel = relative(root, target);

    if (rel === ".." || rel.startsWith("../")) {
        throw new WizError("Executable path escapes package root");
    }

    let actual: string;

    try {
        actual = await realpath(target);
    } catch {
        throw new WizError(`Executable not found: ${relativePath}`);
    }

    const actualRel = relative(await realpath(root), actual);

    if (actualRel === ".." || actualRel.startsWith("../")) {
        throw new WizError("Executable symlink escapes package root");
    }

    const stat = await lstat(actual);

    if (!stat.isFile() || (stat.mode & 0o111) === 0) {
        throw new WizError(`File is not executable: ${relativePath}`);
    }

    await access(actual);

    return actual;
}
