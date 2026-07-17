import { access } from "node:fs/promises";
import { join } from "node:path";
import { storePath } from "../dependencies/store.ts";
import { wizHome } from "../project/discovery.ts";
import { readProject } from "./context.ts";

/** Explains every locked dependency path leading to a package name. */
export async function why(packageName: string): Promise<readonly string[]> {
    const state = await readProject();

    if (state.lockfile === undefined) {
        return [
            `${packageName} is not installed because wiz.lock.json is absent`,
        ];
    }

    const packages = new Map(
        state.lockfile.packages.map((item) => {
            return [item.id, item] as const;
        }),
    );

    const paths: string[] = [];

    const visit = (id: string, chain: readonly string[]): void => {
        const item = packages.get(id);

        if (item === undefined || chain.includes(item.id)) {
            return;
        }

        const next = [...chain, item.id];

        if (item.name === packageName) {
            paths.push(
                next
                    .map((entry) => {
                        return packages.get(entry)?.name ?? entry;
                    })
                    .join(" -> "),
            );
        }

        for (const dependency of Object.values(item.dependencies)) {
            visit(dependency, next);
        }
    };

    for (const [name, id] of Object.entries(state.lockfile.rootDependencies)) {
        const item = packages.get(id);

        if (item?.name === packageName) {
            paths.push(`${state.manifest.package.name} -> ${name}`);
        }

        visit(id, []);
    }

    return paths.length === 0
        ? [`${packageName} is not present in the dependency graph`]
        : [...new Set(paths)].toSorted();
}

/** Checks project metadata, installed links, and immutable cache entries. */
export async function doctor(): Promise<readonly string[]> {
    const state = await readProject();

    const messages = [`ok manifest ${state.manifest.package.name}`];

    if (state.lockfile === undefined) {
        messages.push("warning wiz.lock.json is absent; run wiz install");

        return messages;
    }

    messages.push(
        `ok lockfile v${state.lockfile.lockfileVersion} (${state.lockfile.packages.length} packages)`,
    );

    for (const name of Object.keys(
        state.lockfile.rootDependencies,
    ).toSorted()) {
        try {
            await access(join(state.root, "wiz_modules", name));

            messages.push(`ok installed ${name}`);
        } catch {
            messages.push(`error missing wiz_modules/${name}; run wiz install`);
        }
    }

    return messages;
}

/** Verifies immutable cache records referenced by the current lockfile. */
export async function verifyCache(): Promise<readonly string[]> {
    const state = await readProject();

    const messages: string[] = [];

    for (const item of state.lockfile?.packages ?? []) {
        if (item.workspacePath !== undefined || item.localPath !== undefined) {
            messages.push(`ok live ${item.name}`);

            continue;
        }

        const path = storePath(wizHome(), item.repo, item.commit);

        try {
            await access(join(path, "manifest.json"));

            messages.push(`ok ${item.name}@${item.commit}`);
        } catch {
            messages.push(`error cache miss ${item.name}@${item.commit}`);
        }
    }

    return messages.toSorted();
}
