import { readGlobalLinks } from "../global/links.ts";
import { readGlobalPackages } from "../global/packages.ts";
import { wizHome } from "../project/discovery.ts";
import type { Person } from "../types.ts";
import { readProject } from "./context.ts";

export async function list(global: boolean): Promise<string[]> {
    if (global) {
        const packages = await readGlobalPackages(wizHome());

        const links = await readGlobalLinks(wizHome());

        return [
            ...Object.values(packages).map((item) => {
                return `${item.name}@${item.commit.slice(0, 12)}`;
            }),
            ...Object.entries(links).map(([name, item]) => {
                return `${name} (linked: ${item.path})`;
            }),
        ].sort();
    }

    const state = await readProject();

    return (state.lockfile?.packages ?? [])
        .map((item) => {
            const direct = item.direct ? " (direct)" : "";

            if (item.workspacePath !== undefined) {
                return `${item.name} (workspace: ${item.workspacePath})${direct}`;
            }

            return `${item.name}@${item.commit.slice(0, 12)}${direct}`;
        })
        .sort();
}

function formatPerson(person: Person): string {
    const fields = [person.name];

    if (person.email !== undefined) {
        fields.push(`<${person.email}>`);
    }

    if (person.url !== undefined) {
        fields.push(`(${person.url})`);
    }

    return fields.join(" ");
}

/** Returns deterministic, human-readable information for the current project. */
export async function info(): Promise<string[]> {
    const { manifest } = await readProject();

    const metadata = manifest.package;

    const lines = [`Name: ${metadata.name}`];

    if (metadata.version !== undefined) {
        lines.push(`Version: ${metadata.version}`);
    }

    if (metadata.description !== undefined) {
        lines.push(`Description: ${metadata.description}`);
    }

    if (metadata.license !== undefined) {
        lines.push(`License: ${metadata.license}`);
    }

    if (metadata.author !== undefined) {
        lines.push(`Author: ${formatPerson(metadata.author)}`);
    }

    for (const contributor of metadata.contributors ?? []) {
        lines.push(`Contributor: ${formatPerson(contributor)}`);
    }

    if (metadata.contact !== undefined) {
        lines.push(`Contact: ${metadata.contact}`);
    }

    if (metadata.repository !== undefined) {
        let directory = "";

        if (metadata.repository.directory !== undefined) {
            directory = ` (directory: ${metadata.repository.directory})`;
        }

        lines.push(`Repository: ${metadata.repository.url}${directory}`);
    }

    if (metadata.homepage !== undefined) {
        lines.push(`Homepage: ${metadata.homepage}`);
    }

    if (metadata.bugs?.url !== undefined) {
        lines.push(`Bugs: ${metadata.bugs.url}`);
    }

    if (metadata.bugs?.email !== undefined) {
        lines.push(`Bugs email: ${metadata.bugs.email}`);
    }

    if (metadata.keywords !== undefined) {
        lines.push(`Keywords: ${metadata.keywords.join(", ")}`);
    }

    for (const funding of metadata.funding ?? []) {
        lines.push(`Funding: ${funding}`);
    }

    if (metadata.private !== undefined) {
        lines.push(`Private: ${metadata.private ? "yes" : "no"}`);
    }

    if (metadata.index !== undefined) {
        lines.push(`Index: ${metadata.index}`);
    }

    for (const [name, url] of Object.entries(metadata.links ?? {}).sort(
        ([a], [b]) => {
            return a.localeCompare(b);
        },
    )) {
        lines.push(`Link (${name}): ${url}`);
    }

    for (const [name, spec] of Object.entries(manifest.dependencies).sort(
        ([a], [b]) => {
            return a.localeCompare(b);
        },
    )) {
        if ("workspace" in spec) {
            lines.push(`Dependency (${name}): workspace [${spec.workspace}]`);

            continue;
        }

        if ("path" in spec) {
            lines.push(`Dependency (${name}): local [${spec.path}]`);

            continue;
        }

        if ("version" in spec) {
            lines.push(
                `Dependency (${name}): registry ${spec.registry ?? "default"} [${spec.version}]`,
            );

            continue;
        }

        const selection = spec.commit ?? spec.branch ?? "default branch";

        lines.push(`Dependency (${name}): ${spec.repo} [${selection}]`);
    }

    for (const [name, path] of Object.entries(manifest.bins).sort(
        ([a], [b]) => {
            return a.localeCompare(b);
        },
    )) {
        lines.push(`Bin (${name}): ${path}`);
    }

    for (const [name, command] of Object.entries(manifest.scripts).sort(
        ([a], [b]) => {
            return a.localeCompare(b);
        },
    )) {
        lines.push(`Script (${name}): ${command}`);
    }

    return lines;
}
