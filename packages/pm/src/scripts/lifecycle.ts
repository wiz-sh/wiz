export { lifecycleEnvironment } from "./environment.ts";
export { executableInside } from "./executable.ts";

export async function runLifecycleScript(
    command: string,
    cwd: string,
    environment: Record<string, string | undefined>,
): Promise<number> {
    const child = Bun.spawn(
        ["/usr/bin/env", "bash", "-c", command, "wiz-postinstall"],
        {
            cwd,
            env: { ...process.env, ...environment },
            stdin: "ignore",
            stdout: "inherit",
            stderr: "inherit",
        },
    );

    return child.exited;
}
