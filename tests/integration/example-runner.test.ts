import { expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { parseManifest } from "@wiz-sh/pm";

const runner = join(import.meta.dir, "../../examples/cli.ts");

function run(arguments_: readonly string[]) {
    return Bun.spawnSync([process.execPath, runner, ...arguments_], {
        cwd: join(import.meta.dir, "../../examples"),
        env: process.env,
    });
}

test("the examples CLI discovers package, registry, and Wiz projects", () => {
    const result = run(["list"]);

    const output = result.stdout.toString();

    expect(result.exitCode).toBe(0);

    expect(output).toContain("package-management/command-runner");

    expect(output).toContain("package-management/git-dependency");

    expect(output).toContain("packages/public-package");

    expect(output).toContain("packages/mixed-git-registry");

    expect(output).toContain("registry/docker-compose");

    expect(output).toContain("registry/multiple-registries");

    expect(output).toContain("wiz/hello-world");

    expect(output).toContain("wiz/compiler-targets");
});

test("the examples CLI runs short names in an isolated workspace", () => {
    const result = run(["hello-world"]);

    expect(result.exitCode).toBe(0);

    expect(result.stdout.toString()).toContain("Hello, Wiz!");

    expect(result.stdout.toString()).toContain("✓ wiz/hello-world");
});

test("the examples CLI rejects paths outside its discovered catalog", () => {
    const result = run(["../../package.json"]);

    expect(result.exitCode).toBe(1);

    expect(result.stderr.toString()).toContain("Unknown example");
});

test("every registry package example has a publishable manifest", async () => {
    const examplesRoot = join(import.meta.dir, "../../examples");

    const manifests = new Bun.Glob("packages/*/manifest.json");

    for await (const relative of manifests.scan(examplesRoot)) {
        const path = join(examplesRoot, relative);

        const manifest = parseManifest(
            await Bun.file(path).text(),
            dirname(path),
        );

        expect(manifest.package.version, relative).toMatch(/^\d+\.\d+\.\d+$/);

        expect(manifest.package.name, relative).not.toBe("");
    }
});
