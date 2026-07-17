import type { Manifest, Person } from "../types.ts";
import { type JsonObject, serializeJson } from "../utils/json.ts";

export const MANIFEST_SCHEMA_URL =
    "https://raw.githubusercontent.com/hazelcaffe/wiz/main/packages/pm/schemas/manifest.schema.json";

function serializePerson(person: Person): JsonObject {
    const result: JsonObject = { name: person.name };

    if (person.email !== undefined) {
        result.email = person.email;
    }

    if (person.url !== undefined) {
        result.url = person.url;
    }

    return result;
}

function serializeStringRecord(
    value: Readonly<Record<string, string>>,
): JsonObject {
    return Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => {
            return a.localeCompare(b);
        }),
    );
}

function serializePackage(manifest: Manifest): JsonObject {
    const metadata = manifest.package;

    const result: JsonObject = { name: metadata.name };

    if (metadata.version !== undefined) {
        result.version = metadata.version;
    }

    if (metadata.index !== undefined) {
        result.main = metadata.index;
    }

    if (metadata.description !== undefined) {
        result.description = metadata.description;
    }

    if (metadata.license !== undefined) {
        result.license = metadata.license;
    }

    if (metadata.author !== undefined) {
        result.author = serializePerson(metadata.author);
    }

    if (metadata.contributors !== undefined) {
        result.contributors = metadata.contributors.map(serializePerson);
    }

    if (metadata.contact !== undefined) {
        result.contact = metadata.contact;
    }

    if (metadata.repository !== undefined) {
        const repository: JsonObject = {
            type: metadata.repository.type,
            url: metadata.repository.url,
        };

        if (metadata.repository.directory !== undefined) {
            repository.directory = metadata.repository.directory;
        }

        result.repository = repository;
    }

    if (metadata.homepage !== undefined) {
        result.homepage = metadata.homepage;
    }

    if (metadata.bugs !== undefined) {
        const bugs: JsonObject = {};

        if (metadata.bugs.url !== undefined) {
            bugs.url = metadata.bugs.url;
        }

        if (metadata.bugs.email !== undefined) {
            bugs.email = metadata.bugs.email;
        }

        result.bugs = bugs;
    }

    if (metadata.keywords !== undefined) {
        result.keywords = [...metadata.keywords];
    }

    if (metadata.funding !== undefined) {
        result.funding = [...metadata.funding];
    }

    if (metadata.links !== undefined) {
        result.links = serializeStringRecord(metadata.links);
    }

    if (metadata.private !== undefined) {
        result.private = metadata.private;
    }

    return result;
}

function serializeDependencies(manifest: Manifest): JsonObject {
    const result: JsonObject = {};

    const dependencies = Object.entries(manifest.dependencies).sort(
        ([a], [b]) => {
            return a.localeCompare(b);
        },
    );

    for (const [name, dependency] of dependencies) {
        if ("workspace" in dependency) {
            result[name] = { workspace: dependency.workspace };

            continue;
        }

        if ("path" in dependency) {
            result[name] = { path: dependency.path };

            continue;
        }

        if ("version" in dependency) {
            result[name] =
                dependency.registry === undefined
                    ? dependency.version
                    : {
                          registry: dependency.registry,
                          version: dependency.version,
                      };

            continue;
        }

        const serialized: JsonObject = { repo: dependency.repo };

        if (dependency.branch !== undefined) {
            serialized.branch = dependency.branch;
        }

        if (dependency.commit !== undefined) {
            serialized.commit = dependency.commit;
        }

        result[name] = serialized;
    }

    return result;
}

export function serializeManifest(manifest: Manifest): string {
    const result: JsonObject = {
        $schema: MANIFEST_SCHEMA_URL,
        ...serializePackage(manifest),
        scripts: serializeStringRecord(manifest.scripts),
        bin: serializeStringRecord(manifest.bins),
        dependencies: serializeDependencies(manifest),
    };

    if (manifest.workspaces !== undefined && manifest.workspaces.length > 0) {
        result.workspaces = [...manifest.workspaces];
    }

    if (manifest.registries !== undefined) {
        result.registries = {
            ...(manifest.registries.default === undefined
                ? {}
                : { default: manifest.registries.default }),
            ...(manifest.registries.scopes === undefined
                ? {}
                : {
                      scopes: serializeStringRecord(manifest.registries.scopes),
                  }),
        };
    }

    return serializeJson(result);
}
