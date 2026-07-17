import { expect, test } from "bun:test";
import { needs, resolveSystemExecutable } from "../src/index.ts";

test("system executable resolution uses PATH", () => {
    expect(resolveSystemExecutable("bash")).toBeString();
});

test("needs explains missing executable requirements", () => {
    expect(() => {
        needs("definitely-not-a-wiz-runtime-test-binary");
    }).toThrow("Required binary is not installed");
});
