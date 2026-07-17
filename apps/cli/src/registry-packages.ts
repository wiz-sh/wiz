import { createHash } from "node:crypto";
import { readProject, WizError } from "@wiz/pm";
import {
    loadUserRegistryConfig,
    RegistryClient,
    RegistryError,
    selectRegistry,
} from "@wiz/registry-client";

function selectedClient(
    packageName: string,
    project?: { default?: string; scopes?: Readonly<Record<string, string>> },
) {
    return loadUserRegistryConfig().then((user) => {
        const selected = selectRegistry(packageName, user, {
            ...(project === undefined ? {} : { project }),
        });

        return {
            name: selected.name,
            client: new RegistryClient({
                baseUrl: selected.url,
                ...(selected.token === undefined
                    ? {}
                    : { token: selected.token }),
            }),
        };
    });
}

async function projectArchive(root: string): Promise<Uint8Array> {
    const files: Record<string, Uint8Array> = {};

    const glob = new Bun.Glob("**/*");

    for await (const path of glob.scan({
        cwd: root,
        onlyFiles: true,
        dot: true,
    })) {
        if (
            path === "wiz.lock.json" ||
            path.startsWith(".git/") ||
            path.startsWith("node_modules/") ||
            path.startsWith("wiz_modules/") ||
            path.startsWith("dist/")
        ) {
            continue;
        }

        files[path] = new Uint8Array(
            await Bun.file(`${root}/${path}`).arrayBuffer(),
        );
    }

    if (files["manifest.json"] === undefined) {
        throw new WizError("Cannot publish a project without manifest.json");
    }

    const ordered = Object.fromEntries(
        Object.entries(files).toSorted(([left], [right]) => {
            return left.localeCompare(right);
        }),
    );

    return new Bun.Archive(ordered, { compress: "gzip", level: 9 }).bytes();
}

function integrity(bytes: Uint8Array): string {
    return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

export async function publishMain(args: readonly string[]): Promise<number> {
    const state = await readProject();

    const name = state.manifest.package.name;

    const version = state.manifest.package.version;

    if (version === undefined) {
        throw new WizError("Published packages require a semantic version");
    }

    if (
        state.manifest.package.private === true &&
        !args.includes("--access=private")
    ) {
        throw new WizError(
            "Private manifests require an explicit --access=private publication",
        );
    }

    const selected = await selectedClient(name, state.manifest.registries);

    try {
        await selected.client.packages.get(name);
    } catch (err) {
        if (!(err instanceof RegistryError) || err.status !== 404) {
            throw err;
        }

        await selected.client.packages.create({
            name,
            ...(state.manifest.package.description === undefined
                ? {}
                : { description: state.manifest.package.description }),
            visibility:
                state.manifest.package.private === true ? "private" : "public",
        });
    }

    const archive = await projectArchive(state.root);

    const transaction = await selected.client.publishing.create(name, {
        version,
        integrity: integrity(archive),
        size: archive.byteLength,
    });

    await selected.client.publishing.upload(
        name,
        transaction.id,
        new Blob([Uint8Array.from(archive)]),
    );

    const published = await selected.client.publishing.finalize(
        name,
        transaction.id,
    );

    if (published.state !== "published") {
        throw new WizError(published.error ?? "Registry publication failed");
    }

    console.log(`Published ${name}@${version} to ${selected.name}`);

    return 0;
}

export async function searchMain(args: readonly string[]): Promise<number> {
    const query = args.join(" ").trim();

    if (query === "") {
        throw new WizError("Missing search query");
    }

    const selected = await selectedClient("wiz");

    const results = await selected.client.searchResource.packages(query);

    for (const item of results.items) {
        console.log(
            `${item.name}${item.latestVersion === undefined ? "" : `@${item.latestVersion}`}\t${item.description ?? ""}`,
        );
    }

    return 0;
}

export async function viewMain(args: readonly string[]): Promise<number> {
    const name = args[0];

    if (name === undefined) {
        throw new WizError("Missing package name");
    }

    const selected = await selectedClient(name);

    console.log(
        JSON.stringify(await selected.client.packages.get(name), null, 4),
    );

    return 0;
}

export async function deprecateMain(args: readonly string[]): Promise<number> {
    const selector = args[0];

    const message = args.slice(1).join(" ").trim();

    if (selector === undefined || message === "") {
        throw new WizError(
            "Usage: wiz deprecate <package>@<version> <message>",
        );
    }

    const separator = selector.lastIndexOf("@");

    if (separator <= selector.indexOf("/")) {
        throw new WizError("Deprecation requires an exact package version");
    }

    const name = selector.slice(0, separator);

    const version = selector.slice(separator + 1);

    const selected = await selectedClient(name);

    await selected.client.packages.deprecate(name, version, message);

    console.log(`Deprecated ${name}@${version}`);

    return 0;
}

export async function organizationMain(
    args: readonly string[],
): Promise<number> {
    const command = args[0];

    const selected = await selectedClient("wiz");

    if (command === "list") {
        const organizations = await selected.client.organizations.list();

        for (const organization of organizations.items) {
            console.log(
                `${organization.name}\t${organization.role ?? "member"}`,
            );
        }

        return 0;
    }

    if (command === "create") {
        const name = args[1];

        if (name === undefined) {
            throw new WizError("Missing organization name");
        }

        const organization = await selected.client.organizations.create({
            name,
            displayName: args.slice(2).join(" ") || name,
        });

        console.log(`Created @${organization.name}`);

        return 0;
    }

    if (command === "view") {
        const name = args[1];

        if (name === undefined) {
            throw new WizError("Missing organization name");
        }

        const response = await selected.client.transport.request({
            path: `/v1/orgs/${encodeURIComponent(name)}`,
        });

        console.log(JSON.stringify(response, null, 4));

        return 0;
    }

    throw new WizError("Usage: wiz org create|list|view");
}
