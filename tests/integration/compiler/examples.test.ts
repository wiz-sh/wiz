import { afterEach, expect, test } from "bun:test";
import { cp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { temporaryDirectory } from "../../utils/filesystem.ts";
import { runCli } from "../../utils/process.ts";

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

test("every documented Wiz example checks, formats, lints and emits valid Bash", async () => {
    const examplesRoot = join(import.meta.dir, "../../../examples/wiz");

    for (const name of await readdir(examplesRoot)) {
        const root = await temporaryDirectory();

        roots.push(root);

        await cp(join(examplesRoot, name), root, { recursive: true });

        const home = join(root, ".home");

        expect(
            (await runCli(root, ["c", "check"], home)).code,
            `${name} check`,
        ).toBe(0);

        expect(
            (await runCli(root, ["format", "--check", "."], home)).code,
            `${name} format`,
        ).toBe(0);

        expect(
            (await runCli(root, ["lint", "."], home)).code,
            `${name} lint`,
        ).toBe(0);

        expect(
            (await runCli(root, ["c", "build"], home)).code,
            `${name} build`,
        ).toBe(0);

        const dist = join(root, "dist");

        for (const file of await readdir(dist)) {
            if (file.endsWith(".sh")) {
                expect(
                    Bun.spawnSync(["bash", "-n", join(dist, file)]).exitCode,
                    `${name}/${file}`,
                ).toBe(0);
            }
        }
    }
}, 30_000);

test("the compiler-target example emits every target and executes available shells", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    await cp(
        join(import.meta.dir, "../../../examples/wiz/compiler-targets"),
        root,
        { recursive: true },
    );

    const home = join(root, ".home");

    const targets = [
        { name: "bash", executable: "bash", extension: "sh" },
        { name: "zsh", executable: "zsh", extension: "zsh" },
        { name: "sh", executable: "sh", extension: "sh" },
        { name: "fish", executable: "fish", extension: "fish" },
        { name: "powershell", executable: "pwsh", extension: "ps1" },
        { name: "cmd", executable: "cmd.exe", extension: "cmd" },
    ] as const;

    for (const target of targets) {
        await rm(join(root, "dist"), { recursive: true, force: true });

        const build = await runCli(
            root,
            ["c", "build", "--target", target.name],
            home,
        );

        expect(build.code, `${target.name} build: ${build.stderr}`).toBe(0);

        const executable = Bun.which(target.executable);

        if (executable === null) {
            continue;
        }

        const script = join(root, "dist", `main.${target.extension}`);

        const syntax =
            target.name === "powershell"
                ? Bun.spawnSync([
                      executable,
                      "-NoLogo",
                      "-NoProfile",
                      "-NonInteractive",
                      "-Command",
                      `$null = [scriptblock]::Create((Get-Content -Raw -LiteralPath '${script.replaceAll("'", "''")}'))`,
                  ])
                : Bun.spawnSync([executable, "-n", script]);

        expect(syntax.exitCode, `${target.name} syntax`).toBe(0);

        const execution = Bun.spawnSync(
            target.name === "powershell"
                ? [
                      executable,
                      "-NoLogo",
                      "-NoProfile",
                      "-NonInteractive",
                      "-File",
                      script,
                  ]
                : [executable, script],
            { cwd: root },
        );

        expect(execution.exitCode, `${target.name} execution`).toBe(0);

        expect(execution.stdout.toString()).toBe("Target: portable\n");
    }
});

test("the bundling example emits one compact standalone script", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    await cp(join(import.meta.dir, "../../../examples/wiz/bundling"), root, {
        recursive: true,
    });

    const home = join(root, ".home");

    const build = await runCli(
        root,
        ["c", "build", "--bundle", "--minify"],
        home,
    );

    expect(build.code, build.stderr).toBe(0);

    const scripts = (await readdir(join(root, "dist"))).filter((file) => {
        return file.endsWith(".sh");
    });

    expect(scripts).toEqual(["main.sh"]);

    const execution = Bun.spawnSync(["bash", join(root, "dist/main.sh")], {
        cwd: root,
    });

    expect(execution.exitCode).toBe(0);

    expect(execution.stdout.toString()).toBe(
        "Hello, bundled Wiz!\nLegacy module loaded.\n",
    );
});

test("the binary-data example preserves null bytes end to end", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    await cp(join(import.meta.dir, "../../../examples/wiz/binary-data"), root, {
        recursive: true,
    });

    const home = join(root, ".home");

    const build = await runCli(root, ["c", "build"], home);

    expect(build.code, build.stderr).toBe(0);

    const execution = Bun.spawnSync(["bash", join(root, "dist/main.sh")], {
        cwd: root,
    });

    expect(execution.exitCode).toBe(0);

    expect(execution.stdout.toString()).toBe("Captured bytes: 16\n");

    const expected = new TextEncoder().encode("header\0body\0tail");

    expect([...(await readFile(join(root, "dist/payload.bin")))]).toEqual([
        ...expected,
    ]);

    expect([...(await readFile(join(root, "dist/copied.bin")))]).toEqual([
        ...expected,
    ]);
});
