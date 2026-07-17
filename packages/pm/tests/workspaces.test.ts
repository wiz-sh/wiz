import { afterEach, expect, test } from "bun:test";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { temporaryDirectory } from "../../../tests/utils/filesystem.ts";
import { manifest } from "../../../tests/utils/fixtures.ts";
import { install, packageInfo } from "../src/index.ts";
import { readLockfile } from "../src/project/lockfile.ts";
import {
    discoverWorkspaces,
    findWorkspaceRoot,
} from "../src/project/workspaces.ts";

const roots: string[] = [];
const originalCwd = process.cwd();
const originalHome = process.env.WIZ_HOME;
const originalPackageId = process.env.WIZ_PACKAGE_ID;

async function createRoot(): Promise<string> {
    const root = await temporaryDirectory("wiz-workspaces-");

    roots.push(root);

    await mkdir(join(root, "packages", "core"), { recursive: true });

    await mkdir(join(root, "packages", "tools"), { recursive: true });

    await mkdir(join(root, "apps", "site", "src"), { recursive: true });

    await writeFile(
        join(root, "manifest.json"),
        manifest("suite", {
            package: { private: true },
            workspaces: ["packages/*", "apps/*"],
        }),
    );

    await writeFile(
        join(root, "packages", "core", "manifest.json"),
        manifest("core", {
            package: { index: "index.sh" },
        }),
    );

    await writeFile(
        join(root, "packages", "core", "index.sh"),
        "CORE_VALUE=one\n",
    );

    await writeFile(
        join(root, "packages", "tools", "manifest.json"),
        manifest("tools", {
            package: { index: "index.sh" },
            dependencies: {
                core: { workspace: "*" },
            },
        }),
    );

    await writeFile(
        join(root, "packages", "tools", "index.sh"),
        'source "$(dirname "' +
            "$" +
            '{BASH_SOURCE[0]}")/wiz_modules/core/index.sh"\n',
    );

    await writeFile(
        join(root, "apps", "site", "manifest.json"),
        manifest("site", {
            dependencies: {
                tools: { workspace: "*" },
            },
        }),
    );

    return root;
}

afterEach(async () => {
    process.chdir(originalCwd);

    if (originalHome === undefined) {
        delete process.env.WIZ_HOME;
    } else {
        process.env.WIZ_HOME = originalHome;
    }

    if (originalPackageId === undefined) {
        delete process.env.WIZ_PACKAGE_ID;
    } else {
        process.env.WIZ_PACKAGE_ID = originalPackageId;
    }

    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

test("discovers packages from nested paths with stable relative names", async () => {
    const root = await createRoot();

    const nested = join(root, "apps", "site", "src");

    const project = await discoverWorkspaces(nested);

    expect(await findWorkspaceRoot(nested)).toBe(project.root);

    expect(project.root).toBe(await realpath(root));

    expect([...project.packages.keys()].sort()).toEqual([
        "core",
        "site",
        "tools",
    ]);

    expect(project.packages.get("tools")?.relativePath).toBe("packages/tools");
});

test("installs transitive workspaces as live links and supports frozen mode", async () => {
    const root = await createRoot();

    const site = join(root, "apps", "site");

    process.env.WIZ_HOME = join(root, ".wiz-home");

    process.chdir(site);

    await install(false);

    await install(true);

    const toolsLink = join(site, "wiz_modules", "tools");

    const coreLink = join(toolsLink, "wiz_modules", "core");

    const lockfile = await readLockfile(site);

    process.env.WIZ_PACKAGE_ID = lockfile?.packages.find((item) => {
        return item.name === "tools";
    })?.id;

    const contextualCore = await packageInfo("core");

    expect(await realpath(toolsLink)).toBe(
        await realpath(join(root, "packages", "tools")),
    );

    expect(await readFile(join(coreLink, "index.sh"), "utf8")).toBe(
        "CORE_VALUE=one\n",
    );

    expect(contextualCore.root).toBe(
        await realpath(join(root, "packages", "core")),
    );

    await writeFile(
        join(root, "packages", "core", "index.sh"),
        "CORE_VALUE=two\n",
    );

    expect(await readFile(join(coreLink, "index.sh"), "utf8")).toBe(
        "CORE_VALUE=two\n",
    );

    expect(
        lockfile?.packages
            .map((item) => {
                return item.workspacePath;
            })
            .sort(),
    ).toEqual(["packages/core", "packages/tools"]);
});

test("rejects duplicate workspace package names", async () => {
    const root = await createRoot();

    await mkdir(join(root, "packages", "duplicate"));

    await writeFile(
        join(root, "packages", "duplicate", "manifest.json"),
        manifest("core"),
    );

    expect(discoverWorkspaces(root)).rejects.toThrow(
        "Duplicate workspace package core",
    );
});

test("installing from the root installs every workspace package", async () => {
    const root = await createRoot();

    process.env.WIZ_HOME = join(root, ".wiz-home");

    process.chdir(root);

    await install(false);

    expect(
        await readFile(
            join(root, "apps", "site", "wiz_modules", "tools", "index.sh"),
            "utf8",
        ),
    ).toContain("wiz_modules/core");
});

test("frozen installs reject workspace declarations that moved", async () => {
    const root = await createRoot();

    const site = join(root, "apps", "site");

    process.env.WIZ_HOME = join(root, ".wiz-home");

    process.chdir(site);

    await install(false);

    await writeFile(
        join(root, "manifest.json"),
        manifest("suite", {
            package: { private: true },
            workspaces: ["packages/core", "apps/*"],
        }),
    );

    expect(install(true)).rejects.toThrow("differ");
});

test("workspace cycles fail with a readable package trace", async () => {
    const root = await createRoot();

    await writeFile(
        join(root, "packages", "core", "manifest.json"),
        manifest("core", {
            dependencies: {
                tools: { workspace: "*" },
            },
        }),
    );

    process.env.WIZ_HOME = join(root, ".wiz-home");

    process.chdir(join(root, "apps", "site"));

    expect(install(false)).rejects.toThrow(
        "Dependency cycle: tools -> core -> tools",
    );
});
