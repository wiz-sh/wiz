import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function temporaryDirectory(
    prefix = "wiz-test-",
): Promise<string> {
    return mkdtemp(join(tmpdir(), prefix));
}

export async function executable(
    path: string,
    contents: string,
): Promise<void> {
    await writeFile(path, contents);

    await chmod(path, 0o755);
}
