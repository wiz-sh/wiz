import { afterEach, expect, test } from "bun:test";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { temporaryDirectory } from "../../../../tests/utils/filesystem.ts";
import { init } from "../../src/commands/init.ts";
import { readManifest } from "../../src/project/manifest.ts";

const roots: string[] = [];

async function createTestRoot(): Promise<string> {
    const root = await temporaryDirectory();

    roots.push(root);

    return root;
}

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await rm(root, {
            recursive: true,
            force: true,
        });
    }
});

test("creates a minimal manifest with an explicit package name", async () => {
    const root = await createTestRoot();

    const packageName = await init("demo", root);

    const manifest = await readManifest(root);

    const gitignore = await readFile(join(root, ".gitignore"), "utf8");

    const index = await readFile(join(root, "src/index.sh"), "utf8");

    const indexStat = await lstat(join(root, "src/index.sh"));

    const config = JSON.parse(
        await readFile(join(root, "config.wiz.json"), "utf8"),
    );

    expect(packageName).toBe("demo");

    expect(manifest).toEqual({
        package: {
            name: "demo",
            index: "src/index.sh",
        },
        scripts: {},
        bins: {},
        dependencies: {},
    });

    const manifestSource = await readFile(join(root, "manifest.json"), "utf8");

    expect(manifestSource).toContain('"$schema"');

    expect(manifestSource).toContain('"name": "demo"');

    expect(manifestSource).toContain('"main": "src/index.sh"');

    expect(manifestSource).not.toContain("manifestVersion");

    expect(manifestSource).not.toContain('"package"');

    expect(gitignore).toBe("wiz_modules/\ndist/\n");

    expect(index).toBe("#!/usr/bin/env bash\n");

    expect(indexStat.mode & 0o111).not.toBe(0);

    expect(config).toEqual(
        expect.objectContaining({
            compiler: expect.objectContaining({
                rootDir: "./src",
                outDir: "./dist",
            }),
        }),
    );
});

test("preserves existing gitignore entries and avoids duplicate module rules", async () => {
    const root = await createTestRoot();

    const ignoredRoot = join(root, "already-ignored");

    await writeFile(join(root, ".gitignore"), "dist/");

    await init("demo", root);

    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe(
        "dist/\nwiz_modules/\n",
    );

    await mkdir(ignoredRoot);

    await writeFile(join(ignoredRoot, ".gitignore"), "/wiz_modules/\n.env\n");

    await init("ignored", ignoredRoot);

    expect(await readFile(join(ignoredRoot, ".gitignore"), "utf8")).toBe(
        "/wiz_modules/\n.env\ndist/\n",
    );
});

test("derives a safe package name from the current directory", async () => {
    const root = await createTestRoot();

    const project = join(root, "My Shell Project");

    await mkdir(project);

    const packageName = await init(undefined, project);

    const manifest = await readManifest(project);

    expect(packageName).toBe("my-shell-project");

    expect(manifest.package.name).toBe("my-shell-project");
});

test("creates an explicit private monorepo root", async () => {
    const root = await createTestRoot();

    await init("suite", root, true);

    const manifest = await readManifest(root);

    expect(manifest.package.private).toBe(true);

    expect(manifest.workspaces).toEqual(["packages/*"]);

    expect(await lstat(join(root, "packages"))).toBeDefined();
});

test("rejects invalid names and existing manifests", async () => {
    const root = await createTestRoot();

    const manifestPath = join(root, "manifest.json");

    await expect(init("Invalid Name", root)).rejects.toThrow(
        "Invalid or missing package.name",
    );

    const createdAfterInvalidName = await Bun.file(manifestPath).exists();

    expect(createdAfterInvalidName).toBe(false);

    await writeFile(manifestPath, "existing");

    await expect(init("demo", root)).rejects.toThrow(
        "manifest.json already exists",
    );
});
