import { expect, test } from "bun:test";
import { parseLockfile, validateLockfile } from "../../src/project/lockfile.ts";
import type { JsonValue } from "../../src/utils/json.ts";

const json = (value: JsonValue): string => {
    return JSON.stringify(value);
};

const packageEntry = (id: string, dependencies: Record<string, string>) => {
    return {
        id,
        name: id,
        repo: `/repo/${id}`,
        commit: "a".repeat(40),
        direct: id === "a",
        dependencies,
    };
};

test("unsupported versions fail", () => {
    const source = json({
        lockfileVersion: 3,
        packages: [],
    });

    expect(() => {
        return parseLockfile(source);
    }).toThrow("lockfileVersion");
});

test("missing graph references fail", () => {
    const source = json({
        lockfileVersion: 1,
        rootDependencies: {
            x: "nope",
        },
        packages: [],
    });

    expect(() => {
        return parseLockfile(source);
    }).toThrow("Missing");
});

test("duplicate ids fail", () => {
    const source = json({
        lockfileVersion: 1,
        rootDependencies: {
            x: "x",
        },
        packages: [packageEntry("x", {}), packageEntry("x", {})],
    });

    expect(() => {
        return parseLockfile(source);
    }).toThrow("Duplicate");
});

test("cycles and unreachable package entries fail graph validation", () => {
    const cyclicLockfile = {
        lockfileVersion: 1,
        rootDependencies: {
            a: "a",
        },
        packages: [
            packageEntry("a", {
                b: "b",
            }),
            packageEntry("b", {
                a: "a",
            }),
        ],
    };

    const unreachableLockfile = {
        lockfileVersion: 1,
        rootDependencies: {
            a: "a",
        },
        packages: [packageEntry("a", {}), packageEntry("unused", {})],
    };

    expect(() => {
        return validateLockfile(cyclicLockfile);
    }).toThrow("cycle");

    expect(() => {
        return validateLockfile(unreachableLockfile);
    }).toThrow("Unreachable");
});
