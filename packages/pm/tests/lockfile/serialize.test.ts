import { expect, test } from "bun:test";
import {
    parseLockfile,
    serializeLockfile,
} from "../../src/project/lockfile.ts";
import type { Lockfile } from "../../src/types.ts";

test("serialization is deterministic and sorted", () => {
    const lock = {
        lockfileVersion: 1 as const,
        rootDependencies: {
            z: "z@abc",
            a: "a@def",
        },
        packages: [
            {
                id: "z@abc",
                name: "z",
                repo: "/z",
                commit: "abc",
                direct: true,
                dependencies: {},
            },
            {
                id: "a@def",
                name: "a",
                repo: "/a",
                commit: "def",
                direct: true,
                dependencies: {},
            },
        ],
    };

    const text = serializeLockfile(lock);

    const parsed = parseLockfile(text);

    const packages = [...lock.packages].sort((a, b) => {
        return a.id.localeCompare(b.id);
    });

    expect(text.indexOf('"a"')).toBeLessThan(text.indexOf('"z"'));

    expect(parsed).toEqual({
        ...lock,
        packages,
    });
});

test("workspace lock entries remain portable and validated", () => {
    const lock: Lockfile = {
        lockfileVersion: 1,
        rootDependencies: {
            shared: "shared@workspace:packages/shared",
        },
        packages: [
            {
                id: "shared@workspace:packages/shared",
                name: "shared",
                repo: "workspace:packages/shared",
                commit: "workspace",
                direct: true,
                dependencies: {},
                workspacePath: "packages/shared",
            },
        ],
    };

    expect(parseLockfile(serializeLockfile(lock))).toEqual(lock);
});
