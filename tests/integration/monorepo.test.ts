import { afterEach, expect, spyOn, test } from "bun:test";
import { cp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readManifest } from "../../../package-manager/packages/pm/src/project/manifest.ts";
import { main } from "../../apps/cli/src/cli.ts";
import { temporaryDirectory } from "../utils/filesystem.ts";
import { manifest } from "../utils/fixtures.ts";

const roots: string[] = [];
const originalCwd = process.cwd();
const originalHome = process.env.WIZ_HOME;

afterEach(async () => {
    process.chdir(originalCwd);

    if (originalHome === undefined) {
        delete process.env.WIZ_HOME;
    } else {
        process.env.WIZ_HOME = originalHome;
    }

    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

test("monorepo CLI initializes, lists, adds, locks, and links a workspace", async () => {
    const root = await temporaryDirectory("wiz-monorepo-cli-");

    roots.push(root);

    process.env.WIZ_HOME = join(root, ".wiz-home");

    process.chdir(root);

    const output: string[] = [];

    const log = spyOn(console, "log").mockImplementation((value) => {
        output.push(String(value));
    });

    try {
        expect(await main(["init", "suite", "--monorepo"])).toBe(0);

        const shared = join(root, "packages", "shared");

        await mkdir(shared);

        await writeFile(
            join(shared, "manifest.json"),
            manifest("shared", {
                package: { index: "index.sh" },
                scripts: {
                    check: 'test "$1" = ok',
                },
            }),
        );

        await writeFile(join(shared, "index.sh"), "VALUE=workspace\n");

        expect(await main(["workspace", "list"])).toBe(0);

        expect(await main(["install", "--workspace", "shared"])).toBe(0);

        process.chdir(shared);

        expect(await main(["workspace", "root"])).toBe(0);

        expect(
            await main([
                "workspace",
                "run",
                "check",
                "--if-present",
                "--",
                "ok",
            ]),
        ).toBe(0);

        const rootManifest = await readManifest(root);

        const installed = await readFile(
            join(root, "wiz_modules", "shared", "index.sh"),
            "utf8",
        );

        expect(rootManifest.dependencies.shared).toEqual({ workspace: "*" });

        expect(installed).toBe("VALUE=workspace\n");

        expect(
            output.some((line) => {
                return line.includes("shared\tpackages/shared");
            }),
        ).toBe(true);

        expect(output).toContain(await realpath(root));
    } finally {
        log.mockRestore();
    }
});

test("the documented monorepo example installs and executes", async () => {
    const root = await temporaryDirectory("wiz-monorepo-example-");

    roots.push(root);

    await cp(
        join(originalCwd, "examples", "package-management", "monorepo"),
        root,
        { recursive: true },
    );

    const demo = join(root, "apps", "demo");

    process.env.WIZ_HOME = join(root, ".wiz-home");

    process.chdir(demo);

    expect(await main(["install"])).toBe(0);

    const processHandle = Bun.spawn(["bash", "index.sh"], {
        cwd: demo,
        stdout: "pipe",
        stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(processHandle.stdout).text(),
        new Response(processHandle.stderr).text(),
        processHandle.exited,
    ]);

    expect(exitCode).toBe(0);

    expect(stdout).toBe("Hello from shared\n");

    expect(stderr).toBe("");
});
