import { expect, test } from "bun:test";
import { parseInstallArguments } from "../src/arguments.ts";

test("install arguments separate dependency addition from install modes", () => {
    expect(parseInstallArguments(["install"])).toEqual({
        frozen: false,
        global: false,
    });

    expect(
        parseInstallArguments(["i", "../tools", "--branch", "main"]),
    ).toEqual({
        add: {
            repo: "../tools",
            branch: "main",
        },
        frozen: false,
        global: false,
    });

    expect(parseInstallArguments(["i", "--global"])).toEqual({
        frozen: false,
        global: true,
    });

    expect(parseInstallArguments(["install", "--workspace", "shared"])).toEqual(
        {
            workspace: "shared",
            frozen: false,
            global: false,
        },
    );
});

test("dependency addition rejects incompatible install modes", () => {
    expect(() => {
        parseInstallArguments(["i", "../tools", "--global"]);
    }).toThrow("Cannot add a dependency with --global");

    expect(() => {
        parseInstallArguments(["i", "../tools", "--frozen-lockfile"]);
    }).toThrow("Cannot add a dependency with --frozen-lockfile");

    expect(() => {
        parseInstallArguments(["install", "--workspace", "shared", "--global"]);
    }).toThrow("--workspace cannot be combined");
});
