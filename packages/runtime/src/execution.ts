import { access, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
    type BinRegistration,
    globalPackagePath,
    instancePath,
    type LockedPackage,
    type Manifest,
    packageInfo,
    readBinState,
    readGlobalLinks,
    readManifest,
    readProject,
    readProjectIfPresent,
    readProjectLinks,
    WizError,
    wizHome,
} from "@wiz/pm";
import { runtimeEnvironment } from "./environment.ts";
import { executableInside, runExecutable, runScript } from "./runner.ts";

interface ScopedBin {
    packageName: string;
    binName: string;
}

interface BinCandidate {
    label: string;
    projectRoot: string;
    root: string;
    path: string;
    manifest: Manifest;
    item?: LockedPackage;
}

interface LinkedBin {
    packageName: string;
    root: string;
    path: string;
}

export async function run(
    path: string,
    args: readonly string[],
): Promise<number> {
    const state = await readProject();

    const executable = await executableInside(state.root, path);

    const environment = runtimeEnvironment(
        state.root,
        state.root,
        state.manifest.package.name,
    );

    return runExecutable(executable, args, state.root, environment);
}

export async function script(
    name: string,
    args: readonly string[],
): Promise<number> {
    const state = await readProject();

    const command = state.manifest.scripts[name];

    if (command === undefined) {
        throw new WizError(`Script not found: ${name}`);
    }

    const environment = runtimeEnvironment(
        state.root,
        state.root,
        state.manifest.package.name,
    );

    return runScript(command, args, state.root, environment);
}

async function resolveFileInside(root: string, path: string): Promise<string> {
    const target = resolve(root, path);

    const targetRelative = relative(root, target);

    if (targetRelative === ".." || targetRelative.startsWith("../")) {
        throw new WizError("Index escapes package root");
    }

    let actual: string;

    try {
        actual = await realpath(target);
    } catch {
        throw new WizError(`Index not found: ${path}`);
    }

    const actualRoot = await realpath(root);

    const actualRelative = relative(actualRoot, actual);

    if (actualRelative === ".." || actualRelative.startsWith("../")) {
        throw new WizError("Index symlink escapes package root");
    }

    return actual;
}

export async function indexPath(
    name?: string,
    absolute = false,
): Promise<string> {
    const info = await packageInfo(name);

    const index = info.manifest.package.index;

    if (index === undefined) {
        throw new WizError(
            `Package ${info.manifest.package.name} has no index`,
        );
    }

    await access(await resolveFileInside(info.root, index));

    if (absolute) {
        return resolve(info.root, index);
    }

    if (name === undefined) {
        return index;
    }

    return join(relative(info.projectRoot, info.root), index);
}

function parseScopedBin(specifier: string): ScopedBin | undefined {
    const slash = specifier.indexOf("/");

    if (slash < 1) {
        return undefined;
    }

    return {
        packageName: specifier.slice(0, slash),
        binName: specifier.slice(slash + 1),
    };
}

async function runPackageBin(
    scoped: ScopedBin,
    specifier: string,
    args: readonly string[],
): Promise<number> {
    const info = await packageInfo(scoped.packageName);

    const path = info.manifest.bins[scoped.binName];

    if (path === undefined) {
        throw new WizError(`Bin not found: ${specifier}`);
    }

    const executable = await executableInside(info.root, path);

    const projectRoot =
        info.item === undefined && info.root !== info.projectRoot
            ? info.root
            : info.projectRoot;

    const environment = runtimeEnvironment(
        projectRoot,
        info.root,
        scoped.packageName,
        info.item,
    );

    return runExecutable(executable, args, process.cwd(), environment);
}

async function findGlobalLinkedBin(
    scoped: ScopedBin,
): Promise<LinkedBin | undefined> {
    const registration = (await readGlobalLinks(wizHome()))[scoped.packageName];

    if (registration === undefined) {
        return undefined;
    }

    const path = registration.bins[scoped.binName];

    if (path === undefined) {
        return undefined;
    }

    return {
        packageName: scoped.packageName,
        root: registration.path,
        path,
    };
}

async function runLinkedBin(
    linked: LinkedBin,
    args: readonly string[],
): Promise<number> {
    const executable = await executableInside(linked.root, linked.path);

    const environment = runtimeEnvironment(
        linked.root,
        linked.root,
        linked.packageName,
    );

    return runExecutable(executable, args, process.cwd(), environment);
}

async function findGlobalScopedBin(
    scoped: ScopedBin,
): Promise<BinRegistration | undefined> {
    const state = await readBinState(wizHome());

    return Object.values(state).find((item) => {
        return (
            item.package === scoped.packageName && item.bin === scoped.binName
        );
    });
}

async function runGlobalBin(
    registration: BinRegistration,
    args: readonly string[],
): Promise<number> {
    const root = globalPackagePath(
        wizHome(),
        registration.repo,
        registration.commit,
    );

    const executable = await executableInside(root, registration.path);

    const environment = runtimeEnvironment(root, root, registration.package, {
        commit: registration.commit,
        ...(registration.branch === undefined
            ? {}
            : {
                  resolvedBranch: registration.branch,
              }),
    });

    return runExecutable(executable, args, process.cwd(), environment);
}

async function runScopedBin(
    scoped: ScopedBin,
    specifier: string,
    args: readonly string[],
): Promise<number> {
    try {
        return await runPackageBin(scoped, specifier, args);
    } catch (err) {
        const linked = await findGlobalLinkedBin(scoped);

        if (linked !== undefined) {
            return runLinkedBin(linked, args);
        }

        const global = await findGlobalScopedBin(scoped);

        if (global === undefined) {
            throw err;
        }

        return runGlobalBin(global, args);
    }
}

async function collectBinCandidates(
    specifier: string,
): Promise<BinCandidate[]> {
    const state = await readProjectIfPresent();

    const candidates: BinCandidate[] = [];

    if (state === undefined) {
        return candidates;
    }

    const linkedPackages = await readProjectLinks(state.root);

    const ownPath = state.manifest.bins[specifier];

    if (ownPath !== undefined) {
        candidates.push({
            label: `${state.manifest.package.name}/${specifier}`,
            projectRoot: state.root,
            root: state.root,
            path: ownPath,
            manifest: state.manifest,
        });
    }

    for (const [name, registration] of Object.entries(linkedPackages)) {
        const manifest = await readManifest(registration.path);

        const path = manifest.bins[specifier];

        if (path !== undefined) {
            candidates.push({
                label: `${name}/${specifier}`,
                projectRoot: registration.path,
                root: registration.path,
                path,
                manifest,
            });
        }
    }

    for (const item of state.lockfile?.packages ?? []) {
        if (linkedPackages[item.name] !== undefined) {
            continue;
        }

        const root = instancePath(join(state.root, "wiz_modules"), item);

        const manifest = await readManifest(root);

        const path = manifest.bins[specifier];

        if (path !== undefined) {
            candidates.push({
                label: `${item.name}/${specifier}`,
                projectRoot: state.root,
                root,
                path,
                manifest,
                item,
            });
        }
    }

    return candidates;
}

async function findGlobalLinkedBins(specifier: string): Promise<LinkedBin[]> {
    const links = await readGlobalLinks(wizHome());

    const result: LinkedBin[] = [];

    for (const [packageName, registration] of Object.entries(links)) {
        const path = registration.bins[specifier];

        if (path !== undefined) {
            result.push({
                packageName,
                root: registration.path,
                path,
            });
        }
    }

    return result;
}

async function runCandidate(
    candidate: BinCandidate,
    args: readonly string[],
): Promise<number> {
    const executable = await executableInside(candidate.root, candidate.path);

    const environment = runtimeEnvironment(
        candidate.projectRoot,
        candidate.root,
        candidate.manifest.package.name,
        candidate.item,
    );

    return runExecutable(executable, args, process.cwd(), environment);
}

async function runUnscopedBin(
    specifier: string,
    args: readonly string[],
): Promise<number> {
    const candidates = await collectBinCandidates(specifier);

    if (candidates.length > 1) {
        const choices = candidates
            .map((item) => {
                return item.label;
            })
            .join(" or ");

        throw new WizError(`Ambiguous bin ${specifier}; use ${choices}`);
    }

    const candidate = candidates[0];

    if (candidate !== undefined) {
        return runCandidate(candidate, args);
    }

    const global = (await readBinState(wizHome()))[specifier];

    if (global !== undefined) {
        return runGlobalBin(global, args);
    }

    const linked = await findGlobalLinkedBins(specifier);

    if (linked.length > 1) {
        const choices = linked
            .map((item) => {
                return `${item.packageName}/${specifier}`;
            })
            .join(" or ");

        throw new WizError(`Ambiguous bin ${specifier}; use ${choices}`);
    }

    if (linked[0] !== undefined) {
        return runLinkedBin(linked[0], args);
    }

    throw new WizError(`Bin not found: ${specifier}`);
}

export async function x(
    specifier: string,
    args: readonly string[],
): Promise<number> {
    const scoped = parseScopedBin(specifier);

    if (scoped !== undefined) {
        return runScopedBin(scoped, specifier, args);
    }

    return runUnscopedBin(specifier, args);
}
