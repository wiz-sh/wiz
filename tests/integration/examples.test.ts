import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { temporaryDirectory } from "../utils/filesystem.ts";
import { gitCommand } from "../utils/git.ts";
import { runCli } from "../utils/process.ts";

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

test("the command-runner example executes scripts, bins and runtime helpers", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    await cp(
        join(
            import.meta.dir,
            "../../examples/package-management/command-runner",
        ),
        root,
        { recursive: true },
    );

    const home = join(root, ".home");

    expect(
        await runCli(root, ["script", "greet", "--", "Hazel"], home),
    ).toMatchObject({
        code: 0,
        stdout: "Hello, Hazel!\n",
        stderr: "",
    });

    expect(await runCli(root, ["x", "hello", "--", "Wiz"], home)).toMatchObject(
        {
            code: 0,
            stdout: "Hello, Wiz!\n",
            stderr: "",
        },
    );

    const nested = join(root, "src", "nested");

    await mkdir(nested);

    expect((await runCli(nested, ["root"], home)).stdout.trim()).toBe(
        await realpath(root),
    );

    expect(await runCli(root, ["needs", "bash"], home)).toMatchObject({
        code: 0,
        stderr: "",
    });
});

test("the Git dependency example installs, locks and executes its package", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    const exampleRoot = join(
        import.meta.dir,
        "../../examples/package-management/git-dependency",
    );

    const app = join(root, "app");

    const logger = join(root, "logger");

    await cp(join(exampleRoot, "app"), app, { recursive: true });

    await cp(join(exampleRoot, "logger"), logger, { recursive: true });

    await gitCommand(logger, ["init", "-b", "main"]);

    await gitCommand(logger, ["config", "user.name", "Wiz Examples"]);

    await gitCommand(logger, ["config", "user.email", "wiz@example.invalid"]);

    await gitCommand(logger, ["add", "."]);

    await gitCommand(logger, ["commit", "-m", "example package"]);

    const home = join(root, ".home");

    expect(await runCli(app, ["install", logger], home)).toMatchObject({
        code: 0,
        stdout: "Added logger\n",
        stderr: "",
    });

    expect(
        await runCli(app, ["x", "logger", "--", "installed from Git"], home),
    ).toMatchObject({
        code: 0,
        stdout: "[log] installed from Git\n",
        stderr: "",
    });

    expect(
        await runCli(app, ["install", "--frozen-lockfile"], home),
    ).toMatchObject({
        code: 0,
        stderr: "",
    });
});
