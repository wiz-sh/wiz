export async function runCli(
    cwd: string,
    args: readonly string[],
    home: string,
    input?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
    const cliPath = new URL("../../apps/cli/src/cli.ts", import.meta.url)
        .pathname;

    const child = Bun.spawn(["bun", cliPath, ...args], {
        cwd,
        env: {
            ...process.env,
            HOME: home,
            PATH: `${home}/bin:${process.env.PATH ?? ""}`,
            WIZ_HOME: `${home}/.wiz`,
        },
        stdout: "pipe",
        stderr: "pipe",
        ...(input === undefined
            ? {}
            : {
                  stdin: "pipe",
              }),
    });

    if (input !== undefined) {
        child.stdin.write(input);

        child.stdin.end();
    }

    const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ]);

    return {
        code,
        stdout,
        stderr,
    };
}
