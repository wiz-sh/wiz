import { expect, test } from "bun:test";
import { resolve } from "node:path";
import ts from "typescript";

const repositoryRoot = resolve(import.meta.dir, "../..");
const packageSourcePattern = "apps/cli/src/**/*.ts";
const typescriptPatterns = [
    packageSourcePattern,
    "apps/cli/tests/**/*.ts",
    "tests/**/*.ts",
] as const;

test("source files stay below 800 spacious lines", async () => {
    const sourceFiles = new Bun.Glob(packageSourcePattern);

    for await (const path of sourceFiles.scan({ cwd: repositoryRoot })) {
        const source = await Bun.file(resolve(repositoryRoot, path)).text();

        const lineCount = source.split("\n").length;

        expect(lineCount, `${path} has ${lineCount} lines`).toBeLessThanOrEqual(
            800,
        );
    }
});

test("sibling statements have visual separation", async () => {
    for (const pattern of typescriptPatterns) {
        const files = new Bun.Glob(pattern);

        for await (const path of files.scan({ cwd: repositoryRoot })) {
            const source = await Bun.file(resolve(repositoryRoot, path)).text();

            const file = ts.createSourceFile(
                path,
                source,
                ts.ScriptTarget.Latest,
                true,
            );

            const compact: number[] = [];

            function visit(node: ts.Node): void {
                if (ts.isBlock(node)) {
                    const statements = [...node.statements];

                    for (let index = 1; index < statements.length; index += 1) {
                        const previous = statements[index - 1];

                        const next = statements[index];

                        if (previous === undefined || next === undefined) {
                            continue;
                        }

                        const gap = source.slice(
                            previous.end,
                            next.getStart(file),
                        );

                        if (!/\r?\n[ \t]*\r?\n/.test(gap)) {
                            compact.push(
                                file.getLineAndCharacterOfPosition(
                                    next.getStart(file),
                                ).line + 1,
                            );
                        }
                    }
                }

                ts.forEachChild(node, visit);
            }

            visit(file);

            expect(
                compact,
                `${path} has compact sibling statements on lines ${compact.join(", ")}`,
            ).toEqual([]);
        }
    }
});

test("source does not use explicit any annotations", async () => {
    const sourceFiles = new Bun.Glob(packageSourcePattern);

    for await (const path of sourceFiles.scan({ cwd: repositoryRoot })) {
        const source = await Bun.file(resolve(repositoryRoot, path)).text();

        expect(source, path).not.toMatch(/:\s*any\b|\bas\s+any\b/);
    }
});

test("arrow functions use multiline block bodies", async () => {
    for (const pattern of typescriptPatterns) {
        const files = new Bun.Glob(pattern);

        for await (const path of files.scan({ cwd: repositoryRoot })) {
            const source = await Bun.file(resolve(repositoryRoot, path)).text();

            const file = ts.createSourceFile(
                path,
                source,
                ts.ScriptTarget.Latest,
                true,
            );

            const compact: number[] = [];

            function visit(node: ts.Node): void {
                if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
                    compact.push(
                        file.getLineAndCharacterOfPosition(node.body.getStart())
                            .line + 1,
                    );
                }

                ts.forEachChild(node, visit);
            }

            visit(file);

            expect(
                compact,
                `${path} has expression-bodied arrows on lines ${compact.join(", ")}`,
            ).toEqual([]);
        }
    }
});
