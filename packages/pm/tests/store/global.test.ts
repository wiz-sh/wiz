import { afterEach, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { temporaryDirectory } from "../../../../tests/utils/filesystem.ts";
import {
    readBinState,
    removeWrapper,
    writeBinState,
    writeWrapper,
} from "../../src/global/bins.ts";
import {
    readGlobalLinks,
    readProjectLinks,
    writeGlobalLinks,
    writeProjectLinks,
} from "../../src/global/links.ts";
import {
    readGlobalPackages,
    writeGlobalPackages,
} from "../../src/global/packages.ts";

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

test("global state and wrappers round trip", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    const state = {
        hello: {
            package: "tools",
            repo: "/repo",
            commit: "abc",
            bin: "hello",
            path: "bin/hello",
        },
    };

    await writeBinState(root, state);

    const savedState = await readBinState(root);

    expect(savedState).toEqual(state);

    await writeWrapper(root, "hello", "/tmp/tool");

    const wrapperPath = join(root, "bin", "hello");

    const wrapper = await readFile(wrapperPath, "utf8");

    expect(wrapper).toStartWith("#!/usr/bin/env bash");

    await removeWrapper(root, "hello");

    const wrapperExists = await Bun.file(wrapperPath).exists();

    expect(wrapperExists).toBe(false);
});

test("global package records preserve packages without bins", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    const packages = {
        id: {
            name: "library",
            repo: "/repo",
            commit: "abc",
        },
    };

    await writeGlobalPackages(root, packages);

    const savedPackages = await readGlobalPackages(root);

    expect(savedPackages).toEqual(packages);
});

test("missing state is empty", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    const state = await readBinState(root);

    expect(state).toEqual({});
});

test("global and project link records round trip", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    const globalLinks = {
        tools: {
            path: "/workspace/tools",
            bins: {
                hello: "bin/hello",
            },
        },
    };

    const projectLinks = {
        tools: {
            path: "/workspace/tools",
        },
    };

    await writeGlobalLinks(root, globalLinks);

    await writeProjectLinks(root, projectLinks);

    expect(await readGlobalLinks(root)).toEqual(globalLinks);

    expect(await readProjectLinks(root)).toEqual(projectLinks);
});

test("link records reject unsafe package and bin names", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    await writeFile(
        join(root, "link_state.json"),
        JSON.stringify({
            stateVersion: 1,
            packages: {
                "../outside": {
                    path: "/workspace/tools",
                    bins: {},
                },
            },
        }),
    );

    expect(readGlobalLinks(root)).rejects.toThrow(
        "Invalid linked package name",
    );

    await writeFile(
        join(root, "link_state.json"),
        JSON.stringify({
            stateVersion: 1,
            packages: {
                tools: {
                    path: "/workspace/tools",
                    bins: {
                        "../../outside": "bin/hello",
                    },
                },
            },
        }),
    );

    expect(readGlobalLinks(root)).rejects.toThrow("Invalid linked bin name");
});
