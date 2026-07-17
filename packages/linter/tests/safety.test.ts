import { expect, test } from "bun:test";
import { parseSourceFile } from "@wiz/compiler";
import { lintSourceFile } from "../src/index.ts";

test("dangerous evaluation and invalid statuses are reported", () => {
    const file = parseSourceFile('eval "$code"\nreturn 300\n', "unsafe.wiz");

    const names = lintSourceFile(file).map((diagnostic) => {
        return diagnostic.rule;
    });

    expect(names).toContain("safety/no-eval");

    expect(names).toContain("correctness/no-invalid-return-status");
});
