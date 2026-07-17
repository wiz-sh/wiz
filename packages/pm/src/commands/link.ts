import { access, realpath, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { instancePath } from "../dependencies/resolver.ts";
import { replaceSymlink } from "../dependencies/store.ts";
import { readBinState, removeWrapper, writeWrapper } from "../global/bins.ts";
import {
    readGlobalLinks,
    readProjectLinks,
    writeGlobalLinks,
    writeProjectLinks,
} from "../global/links.ts";
import { readGlobalPackages } from "../global/packages.ts";
import { wizHome } from "../project/discovery.ts";
import { readManifest } from "../project/manifest.ts";
import {
    executableInside,
    lifecycleEnvironment,
} from "../scripts/lifecycle.ts";
import type { LockedPackage } from "../types.ts";
import { WizError } from "../utils/errors.ts";
import { readProject } from "./context.ts";
import { install } from "./install.ts";

function installedRootPackage(
    name: string,
    packages: Awaited<ReturnType<typeof readGlobalPackages>>,
): boolean {
    return Object.values(packages).some((item) => {
        return item.name === name;
    });
}

async function registerGlobalLink(): Promise<string[]> {
    const state = await readProject();

    const root = await realpath(state.root);

    const name = state.manifest.package.name;

    const home = wizHome();

    const links = await readGlobalLinks(home);

    const installedBins = await readBinState(home);

    const installedPackages = await readGlobalPackages(home);

    const existing = links[name];

    if (installedRootPackage(name, installedPackages)) {
        throw new WizError(`Package is already installed globally: ${name}`);
    }

    if (existing !== undefined && existing.path !== root) {
        throw new WizError(
            `Package is already linked from ${existing.path}: ${name}`,
        );
    }

    for (const binName of Object.keys(state.manifest.bins)) {
        if (installedBins[binName] !== undefined) {
            throw new WizError(`Global bin collision: ${binName}`);
        }

        for (const [linkedName, linked] of Object.entries(links)) {
            if (linkedName !== name && linked.bins[binName] !== undefined) {
                throw new WizError(`Global bin collision: ${binName}`);
            }
        }
    }

    for (const path of Object.values(state.manifest.bins)) {
        await executableInside(root, path);
    }

    await install(false);

    for (const oldBin of Object.keys(existing?.bins ?? {})) {
        if (state.manifest.bins[oldBin] === undefined) {
            await removeWrapper(home, oldBin);
        }
    }

    const environment = lifecycleEnvironment(root, root, name);

    for (const [binName, path] of Object.entries(state.manifest.bins)) {
        await writeWrapper(home, binName, join(root, path), environment);
    }

    links[name] = {
        path: root,
        bins: state.manifest.bins,
    };

    await writeGlobalLinks(home, links);

    return [
        `Linked ${name} -> ${root}`,
        `Bins are available from ${join(home, "bin")}`,
    ];
}

async function attachProjectLink(name: string): Promise<string[]> {
    const state = await readProject();

    const registration = (await readGlobalLinks(wizHome()))[name];

    if (registration === undefined) {
        throw new WizError(`Package is not linked globally: ${name}`);
    }

    const target = await realpath(registration.path);

    const manifest = await readManifest(target);

    if (manifest.package.name !== name) {
        throw new WizError(
            `Linked package ${name} now contains package ${manifest.package.name}`,
        );
    }

    const links = await readProjectLinks(state.root);

    const modules = join(state.root, "wiz_modules");

    const destination = join(modules, name);

    const relativeTarget = relative(dirname(destination), target);

    await replaceSymlink(destination, relativeTarget);

    links[name] = {
        path: target,
    };

    await writeProjectLinks(state.root, links);

    return [`Linked ${name} -> ${target}`];
}

export async function link(name?: string): Promise<string[]> {
    if (name === undefined) {
        return registerGlobalLink();
    }

    return attachProjectLink(name);
}

async function unregisterGlobalLink(name: string): Promise<string[]> {
    const home = wizHome();

    const links = await readGlobalLinks(home);

    const registration = links[name];

    if (registration === undefined) {
        throw new WizError(`Package is not linked globally: ${name}`);
    }

    for (const binName of Object.keys(registration.bins)) {
        await removeWrapper(home, binName);
    }

    delete links[name];

    await writeGlobalLinks(home, links);

    return [`Unlinked global package ${name}`];
}

function lockedPackage(
    packages: readonly LockedPackage[],
    id: string,
): LockedPackage | undefined {
    return packages.find((item) => {
        return item.id === id;
    });
}

async function restoreInstalledPackage(
    root: string,
    name: string,
    packageId: string | undefined,
    packages: readonly LockedPackage[],
): Promise<void> {
    const modules = join(root, "wiz_modules");

    const destination = join(modules, name);

    const item = lockedPackage(packages, packageId ?? "");

    await rm(destination, {
        recursive: true,
        force: true,
    });

    if (item === undefined) {
        return;
    }

    const installed = instancePath(modules, item);

    try {
        await access(installed);
    } catch {
        return;
    }

    await replaceSymlink(
        destination,
        relative(dirname(destination), installed),
    );
}

async function detachProjectLink(name: string): Promise<string[]> {
    const state = await readProject();

    const links = await readProjectLinks(state.root);

    if (links[name] === undefined) {
        throw new WizError(`Package is not linked in this project: ${name}`);
    }

    delete links[name];

    await writeProjectLinks(state.root, links);

    await restoreInstalledPackage(
        state.root,
        name,
        state.lockfile?.rootDependencies[name],
        state.lockfile?.packages ?? [],
    );

    return [`Unlinked ${name} from ${state.manifest.package.name}`];
}

export async function unlink(name?: string, global = false): Promise<string[]> {
    if (global) {
        if (name === undefined) {
            throw new WizError("Missing package name");
        }

        return unregisterGlobalLink(name);
    }

    if (name !== undefined) {
        return detachProjectLink(name);
    }

    const state = await readProject();

    const packageName = state.manifest.package.name;

    const registration = (await readGlobalLinks(wizHome()))[packageName];

    if (registration === undefined) {
        throw new WizError(`Package is not linked globally: ${packageName}`);
    }

    if ((await realpath(state.root)) !== registration.path) {
        throw new WizError(
            `Package ${packageName} is linked from another directory`,
        );
    }

    return unregisterGlobalLink(packageName);
}
