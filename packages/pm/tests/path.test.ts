import { expect, test } from "bun:test";
import { resolveInside, safeRelativePath } from "../src/utils/paths.ts";

test("accepts safe relative paths", () => {
    const path = safeRelativePath("a/b", "path");

    expect(path).toBe("a/b");
});

test("rejects traversal", () => {
    expect(() => {
        return safeRelativePath("../secret", "path");
    }).toThrow("escapes");
});

test("resolveInside stays rooted", () => {
    expect(() => {
        return resolveInside("/tmp/root", "../x", "path");
    }).toThrow();
});
