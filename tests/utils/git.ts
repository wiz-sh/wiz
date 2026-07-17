import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function command(cwd: string, args: readonly string[]): Promise<string> {
    const child = Bun.spawn(["git", ...args], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: cwd },
    });

    const output = await new Response(child.stdout).text();

    if ((await child.exited) !== 0) {
        throw new Error(await new Response(child.stderr).text());
    }

    return output.trim();
}

export async function createRepository(
    root: string,
    manifest: string,
    files: Record<string, string> = {},
): Promise<string> {
    await mkdir(root, { recursive: true });

    await command(root, ["init", "-b", "main"]);

    await command(root, ["config", "user.name", "Wiz Tests"]);

    await command(root, ["config", "user.email", "wiz@example.invalid"]);

    await writeFile(join(root, "manifest.json"), manifest);

    for (const [path, contents] of Object.entries(files)) {
        await mkdir(join(root, path, ".."), { recursive: true });

        await writeFile(join(root, path), contents, { mode: 0o755 });
    }

    await command(root, ["add", "."]);

    await command(root, ["commit", "-m", "fixture"]);

    return command(root, ["rev-parse", "HEAD"]);
}

export { command as gitCommand };
