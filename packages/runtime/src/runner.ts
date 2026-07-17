import { access, lstat, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { WizError } from "@wiz/pm";

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

export async function runExecutable(
    path: string,
    args: readonly string[],
    cwd: string,
    env: Record<string, string | undefined> = {},
): Promise<number> {
    const child = Bun.spawn([path, ...args], {
        cwd,
        env: { ...process.env, ...env },
        stdin: "inherit",
        stdout: "pipe",
        stderr: "pipe",
    });

    return forwardOutput(child);
}

/** Runs manifest script strings in Bash; direct executables use their own shebang instead. */
export async function runScript(
    command: string,
    args: readonly string[],
    cwd: string,
    env: Record<string, string | undefined>,
): Promise<number> {
    const child = Bun.spawn(
        ["/usr/bin/env", "bash", "-c", command, "wiz-script", ...args],
        {
            cwd,
            env: { ...process.env, ...env },
            stdin: "inherit",
            stdout: "pipe",
            stderr: "pipe",
        },
    );

    return forwardOutput(child);
}

async function forwardOutput(
    child: Bun.Subprocess<"inherit", "pipe", "pipe">,
): Promise<number> {
    // The CLI must not outlive children or swallow the signal intended for the command.
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

    const handlers = signals.map((signal) => {
        const handler = (): void => {
            child.kill(signal);
        };

        process.on(signal, handler);

        return [signal, handler] as const;
    });

    const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).arrayBuffer(),
        new Response(child.stderr).arrayBuffer(),
        child.exited,
    ]).finally(() => {
        for (const [signal, handler] of handlers) {
            process.off(signal, handler);
        }
    });

    if (stdout.byteLength > 0) {
        await Bun.write(Bun.stdout, new Uint8Array(stdout));
    }

    if (stderr.byteLength > 0) {
        await Bun.write(Bun.stderr, new Uint8Array(stderr));
    }

    return code;
}
