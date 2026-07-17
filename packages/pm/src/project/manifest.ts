import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type {
    DependencySpec,
    Manifest,
    PackageMetadata,
    Person,
    RepositoryMetadata,
} from "../types.ts";
import { WizError } from "../utils/errors.ts";
import {
    assertJsonKeys,
    type JsonObject,
    type JsonValue,
    parseJson,
    requireJsonObject,
} from "../utils/json.ts";
import { safeRelativePath } from "../utils/paths.ts";

const packagePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const binPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const commitPattern = /^[0-9a-fA-F]{7,64}$/;

const metadataKeys = [
    "name",
    "version",
    "index",
    "description",
    "license",
    "author",
    "contributors",
    "contact",
    "repository",
    "homepage",
    "bugs",
    "keywords",
    "funding",
    "links",
    "private",
] as const;

const modernManifestKeys = [
    "$schema",
    "name",
    "version",
    "main",
    "description",
    "license",
    "author",
    "contributors",
    "contact",
    "repository",
    "homepage",
    "bugs",
    "keywords",
    "funding",
    "links",
    "private",
    "scripts",
    "bin",
    "dependencies",
    "workspaces",
    "registries",
] as const;

function registryConfiguration(
    value: JsonValue | undefined,
): Manifest["registries"] {
    if (value === undefined) {
        return undefined;
    }

    const data = requireJsonObject(value, "registries");

    assertJsonKeys(data, ["default", "scopes"], "registries");

    const scopes: Record<string, string> = {};

    if (data.scopes !== undefined) {
        const rawScopes = requireJsonObject(data.scopes, "registries.scopes");

        for (const [scope, registry] of Object.entries(rawScopes)) {
            if (!/^@[a-z0-9][a-z0-9._-]*$/.test(scope)) {
                throw new WizError(`Invalid registry scope: ${scope}`);
            }

            scopes[scope] = nonEmptyString(
                registry,
                `registries.scopes.${scope}`,
            );
        }
    }

    return {
        ...(data.default === undefined
            ? {}
            : { default: nonEmptyString(data.default, "registries.default") }),
        ...(Object.keys(scopes).length === 0 ? {} : { scopes }),
    };
}

function workspacePatterns(value: JsonValue | undefined): string[] {
    if (value === undefined) {
        return [];
    }

    if (!Array.isArray(value)) {
        throw new WizError("workspaces must be an array of path patterns");
    }

    const patterns = value.map((item, index) => {
        const pattern = nonEmptyString(item, `workspaces[${index}]`);

        if (
            isAbsolute(pattern) ||
            pattern.includes("\\") ||
            pattern.split("/").includes("..") ||
            pattern === "."
        ) {
            throw new WizError(
                `workspaces[${index}] must stay within the monorepo root`,
            );
        }

        return pattern.replace(/\/$/, "");
    });

    if (new Set(patterns).size !== patterns.length) {
        throw new WizError("workspaces contains a duplicate path pattern");
    }

    return patterns;
}

function stringMap(
    value: JsonValue | undefined,
    label: string,
    namePattern: RegExp,
): Record<string, string> {
    if (value === undefined) {
        return {};
    }

    const table = requireJsonObject(value, label);

    const result: Record<string, string> = {};

    for (const [name, item] of Object.entries(table)) {
        if (!namePattern.test(name) || name.length === 0) {
            throw new WizError(`Invalid ${label} name: ${name}`);
        }

        if (typeof item !== "string" || item.length === 0) {
            throw new WizError(`${label}.${name} must be a non-empty string`);
        }

        result[name] = item;
    }

    return result;
}

function validRepo(repo: string, baseDirectory: string): boolean {
    if (/^(https?:\/\/|ssh:\/\/|git@[^:]+:)/.test(repo)) {
        return true;
    }

    if (repo.includes("://")) {
        return false;
    }

    return isAbsolute(repo) || resolve(baseDirectory, repo).length > 0;
}

function nonEmptyString(value: JsonValue | undefined, label: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new WizError(`${label} must be a non-empty string`);
    }

    return value;
}

function webUrl(value: JsonValue | undefined, label: string): string {
    const url = nonEmptyString(value, label);

    let parsed: URL;

    try {
        parsed = new URL(url);
    } catch {
        throw new WizError(`${label} must be an absolute URL`);
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new WizError(`${label} must use http or https`);
    }

    return url;
}

function email(value: JsonValue | undefined, label: string): string {
    const address = nonEmptyString(value, label);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
        throw new WizError(`${label} must be an email address`);
    }

    return address;
}

function person(value: JsonValue | undefined, label: string): Person {
    if (typeof value === "string") {
        return { name: nonEmptyString(value, label) };
    }

    const data = requireJsonObject(value, label);

    assertJsonKeys(data, ["name", "email", "url"], label);

    return {
        name: nonEmptyString(data.name, `${label}.name`),
        ...(data.email === undefined
            ? {}
            : { email: email(data.email, `${label}.email`) }),
        ...(data.url === undefined
            ? {}
            : { url: webUrl(data.url, `${label}.url`) }),
    };
}

function stringArray(value: JsonValue | undefined, label: string): string[] {
    if (!Array.isArray(value)) {
        throw new WizError(`${label} must be an array of strings`);
    }

    return value.map((item, index) => {
        return nonEmptyString(item, `${label}[${index}]`);
    });
}

function repository(
    value: JsonValue | undefined,
    baseDirectory: string,
): RepositoryMetadata {
    if (typeof value === "string") {
        if (!validRepo(value, baseDirectory)) {
            throw new WizError(
                "package.repository must be a Git URL or local repository path",
            );
        }

        return {
            type: "git",
            url: value,
        };
    }

    const data = requireJsonObject(value, "package.repository");

    assertJsonKeys(data, ["type", "url", "directory"], "package.repository");

    if (data.type !== "git") {
        throw new WizError('package.repository.type must be "git"');
    }

    const url = nonEmptyString(data.url, "package.repository.url");

    if (!validRepo(url, baseDirectory)) {
        throw new WizError(
            "package.repository.url must be a Git URL or local repository path",
        );
    }

    return {
        type: "git",
        url,
        ...(data.directory === undefined
            ? {}
            : {
                  directory: safeRelativePath(
                      data.directory,
                      "package.repository.directory",
                  ),
              }),
    };
}

function bugsMetadata(value: JsonValue): { url?: string; email?: string } {
    if (typeof value === "string") {
        return { url: webUrl(value, "package.bugs") };
    }

    const data = requireJsonObject(value, "package.bugs");

    assertJsonKeys(data, ["url", "email"], "package.bugs");

    if (data.url === undefined && data.email === undefined) {
        throw new WizError("package.bugs requires url or email");
    }

    return {
        ...(data.url === undefined
            ? {}
            : { url: webUrl(data.url, "package.bugs.url") }),
        ...(data.email === undefined
            ? {}
            : { email: email(data.email, "package.bugs.email") }),
    };
}

function linksMetadata(value: JsonValue): Record<string, string> {
    const links = requireJsonObject(value, "package.links");

    const result: Record<string, string> = {};

    for (const [name, url] of Object.entries(links)) {
        result[name] = webUrl(url, `package.links.${name}`);
    }

    return result;
}

function fundingMetadata(value: JsonValue): string[] {
    if (typeof value === "string") {
        return [webUrl(value, "package.funding")];
    }

    return stringArray(value, "package.funding").map((url, index) => {
        return webUrl(url, `package.funding[${index}]`);
    });
}

function packageMetadata(
    metadata: JsonObject,
    baseDirectory: string,
): PackageMetadata {
    assertJsonKeys(metadata, metadataKeys, "package");

    if (
        typeof metadata.name !== "string" ||
        !packagePattern.test(metadata.name)
    ) {
        throw new WizError("Invalid or missing package.name");
    }

    if (
        metadata.private !== undefined &&
        typeof metadata.private !== "boolean"
    ) {
        throw new WizError("package.private must be a boolean");
    }

    const result: PackageMetadata = { name: metadata.name };

    if (metadata.version !== undefined) {
        result.version = nonEmptyString(metadata.version, "package.version");
    }

    if (metadata.index !== undefined) {
        result.index = safeRelativePath(metadata.index, "package.index");
    }

    if (metadata.description !== undefined) {
        result.description = nonEmptyString(
            metadata.description,
            "package.description",
        );
    }

    if (metadata.license !== undefined) {
        result.license = nonEmptyString(metadata.license, "package.license");
    }

    if (metadata.author !== undefined) {
        result.author = person(metadata.author, "package.author");
    }

    if (metadata.contributors !== undefined) {
        if (!Array.isArray(metadata.contributors)) {
            throw new WizError("package.contributors must be an array");
        }

        result.contributors = metadata.contributors.map((item, index) => {
            return person(item, `package.contributors[${index}]`);
        });
    }

    if (metadata.contact !== undefined) {
        result.contact = nonEmptyString(metadata.contact, "package.contact");
    }

    if (metadata.repository !== undefined) {
        result.repository = repository(metadata.repository, baseDirectory);
    }

    if (metadata.homepage !== undefined) {
        result.homepage = webUrl(metadata.homepage, "package.homepage");
    }

    if (metadata.bugs !== undefined) {
        result.bugs = bugsMetadata(metadata.bugs);
    }

    if (metadata.keywords !== undefined) {
        result.keywords = stringArray(metadata.keywords, "package.keywords");
    }

    if (metadata.funding !== undefined) {
        result.funding = fundingMetadata(metadata.funding);
    }

    if (metadata.links !== undefined) {
        result.links = linksMetadata(metadata.links);
    }

    if (metadata.private !== undefined) {
        result.private = metadata.private;
    }

    return result;
}

/** Converts untrusted JSON data into the manifest shape used by the resolver and runners. */
export function validateManifest(
    value: JsonValue,
    baseDirectory = process.cwd(),
): Manifest {
    const root = requireJsonObject(value, "manifest");

    const legacy = root.package !== undefined;

    let metadata: JsonObject;

    if (legacy) {
        assertJsonKeys(
            root,
            [
                "$schema",
                "manifestVersion",
                "package",
                "scripts",
                "bin",
                "dependencies",
                "workspaces",
                "registries",
            ],
            "manifest",
        );

        if (root.manifestVersion !== 1) {
            throw new WizError(
                "Unsupported or missing legacy manifestVersion; expected 1",
            );
        }

        metadata = requireJsonObject(root.package, "package");
    } else {
        assertJsonKeys(root, modernManifestKeys, "manifest");

        metadata = Object.fromEntries(
            metadataKeys.flatMap((key) => {
                if (key === "index") {
                    return root.main === undefined
                        ? []
                        : [["index", root.main]];
                }

                return root[key] === undefined ? [] : [[key, root[key]]];
            }),
        );
    }

    const packageData = packageMetadata(metadata, baseDirectory);

    const scripts = stringMap(root.scripts, "scripts", /^.+$/);

    const bins = stringMap(root.bin, "bin", binPattern);

    for (const [name, path] of Object.entries(bins)) {
        bins[name] = safeRelativePath(path, `bin.${name}`);
    }

    const dependencyTable = requireJsonObject(
        root.dependencies ?? {},
        "dependencies",
    );

    const dependencies: Record<string, DependencySpec> = {};

    for (const [name, raw] of Object.entries(dependencyTable)) {
        if (!packagePattern.test(name)) {
            throw new WizError(`Invalid dependency name: ${name}`);
        }

        if (typeof raw === "string") {
            dependencies[name] = {
                version: nonEmptyString(raw, `dependencies.${name}`),
            };

            continue;
        }

        const spec = requireJsonObject(raw, `dependencies.${name}`);

        assertJsonKeys(
            spec,
            [
                "repo",
                "branch",
                "commit",
                "git",
                "rev",
                "workspace",
                "path",
                "registry",
                "version",
            ],
            `dependencies.${name}`,
        );

        if (spec.workspace !== undefined) {
            if (
                typeof spec.workspace !== "string" ||
                spec.workspace.trim().length === 0
            ) {
                throw new WizError(
                    `Invalid workspace selector for dependency ${name}`,
                );
            }

            if (
                spec.repo !== undefined ||
                spec.git !== undefined ||
                spec.branch !== undefined ||
                spec.commit !== undefined ||
                spec.rev !== undefined ||
                spec.path !== undefined ||
                spec.registry !== undefined ||
                spec.version !== undefined
            ) {
                throw new WizError(
                    `Workspace dependency ${name} cannot also declare Git fields`,
                );
            }

            dependencies[name] = { workspace: spec.workspace };

            continue;
        }

        if (spec.path !== undefined) {
            if (Object.keys(spec).length !== 1) {
                throw new WizError(
                    `Local dependency ${name} cannot declare other source fields`,
                );
            }

            const path = nonEmptyString(spec.path, `dependencies.${name}.path`);

            if (
                isAbsolute(path) ||
                path.includes("\\") ||
                path.includes("\u0000")
            ) {
                throw new WizError(
                    `dependencies.${name}.path must be a portable relative path`,
                );
            }

            dependencies[name] = { path };

            continue;
        }

        if (spec.version !== undefined || spec.registry !== undefined) {
            if (
                spec.repo !== undefined ||
                spec.git !== undefined ||
                spec.branch !== undefined ||
                spec.commit !== undefined ||
                spec.rev !== undefined
            ) {
                throw new WizError(
                    `Registry dependency ${name} cannot declare Git fields`,
                );
            }

            dependencies[name] = {
                version: nonEmptyString(
                    spec.version,
                    `dependencies.${name}.version`,
                ),
                ...(spec.registry === undefined
                    ? {}
                    : {
                          registry: nonEmptyString(
                              spec.registry,
                              `dependencies.${name}.registry`,
                          ),
                      }),
            };

            continue;
        }

        const repository = spec.repo ?? spec.git;

        const commit = spec.commit ?? spec.rev;

        if (
            typeof repository !== "string" ||
            repository.length === 0 ||
            !validRepo(repository, baseDirectory)
        ) {
            throw new WizError(`Invalid repository for dependency ${name}`);
        }

        if (
            spec.branch !== undefined &&
            (typeof spec.branch !== "string" || spec.branch.length === 0)
        ) {
            throw new WizError(`Invalid branch for dependency ${name}`);
        }

        if (
            commit !== undefined &&
            (typeof commit !== "string" || !commitPattern.test(commit))
        ) {
            throw new WizError(`Invalid commit for dependency ${name}`);
        }

        dependencies[name] = {
            repo: repository,
            ...(typeof spec.branch === "string" ? { branch: spec.branch } : {}),
            ...(typeof commit === "string" ? { commit } : {}),
        };
    }

    const workspaces = workspacePatterns(root.workspaces);

    const registries = registryConfiguration(root.registries);

    return {
        package: packageData,
        scripts,
        bins,
        dependencies,
        ...(workspaces.length === 0 ? {} : { workspaces }),
        ...(registries === undefined ? {} : { registries }),
    };
}

export function parseManifest(
    text: string,
    baseDirectory = process.cwd(),
): Manifest {
    return validateManifest(parseJson(text, "manifest.json"), baseDirectory);
}

export async function readManifest(root: string): Promise<Manifest> {
    return parseManifest(
        await readFile(resolve(root, "manifest.json"), "utf8"),
        root,
    );
}

export {
    MANIFEST_SCHEMA_URL,
    serializeManifest,
} from "./manifest-serialization.ts";
