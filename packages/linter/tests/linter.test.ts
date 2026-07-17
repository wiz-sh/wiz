import { expect, test } from "bun:test";
import { parseSourceFile } from "@wiz/compiler";
import {
    applyLintFixes,
    diagnosticsToSarif,
    lintSourceFile,
    registerRule,
    rules,
} from "../src/index.ts";

test("registry exposes all initial stable rule names", () => {
    expect(rules).toHaveLength(19);

    expect(
        rules.map((rule) => {
            return rule.name;
        }),
    ).toContain("safety/no-unquoted-expansion");
});

test("undefined and unquoted variables report exact ranges and safe fixes", () => {
    const source = "printf '%s\\n' $missing\n";

    const diagnostics = lintSourceFile(parseSourceFile(source, "main.wiz"));

    const undefinedVariable = diagnostics.find((diagnostic) => {
        return diagnostic.rule === "correctness/no-undefined-variable";
    });

    const unquoted = diagnostics.find((diagnostic) => {
        return diagnostic.rule === "safety/no-unquoted-expansion";
    });

    expect(undefinedVariable?.range).toEqual({ start: 14, end: 22 });

    expect(unquoted?.severity).toBe("warning");

    expect(unquoted?.fix?.safe).toBe(true);

    expect(
        applyLintFixes(source, unquoted === undefined ? [] : [unquoted]),
    ).toBe("printf '%s\\n' \"$missing\"\n");
});

test("typed vertical slice has no linter false positives", () => {
    const source = `declare -T int port=8080
start_server(string host, path root="/opt"): status {
    printf '%s %s %s\\n' "$host" "$port" "$root"
}
start_server "localhost"
`;

    expect(lintSourceFile(parseSourceFile(source))).toEqual([]);
});

test("suppressions, baselines, plugins, and SARIF support project workflows", () => {
    const file = parseSourceFile(
        `# wiz-ignore safety/no-unquoted-expansion
echo $HOME
echo $MISSING
`,
        "/workspace/main.wiz",
    );

    const unregister = registerRule({
        definition: {
            name: "style/require-header",
            category: "style",
            defaultSeverity: "warning",
            description: "Requires the project header.",
            fixable: "none",
        },
        run(context): void {
            context.report("Project header is missing", { start: 0, end: 0 });
        },
    });

    const diagnostics = lintSourceFile(file, {
        baseline: [
            {
                fileName: "/workspace/main.wiz",
                rule: "correctness/no-undefined-variable",
            },
        ],
    });

    unregister();

    expect(diagnostics).toContainEqual(
        expect.objectContaining({ rule: "style/require-header" }),
    );

    expect(diagnostics).not.toContainEqual(
        expect.objectContaining({ rule: "correctness/no-undefined-variable" }),
    );

    expect(
        diagnostics.filter((diagnostic) => {
            return diagnostic.rule === "safety/no-unquoted-expansion";
        }),
    ).toHaveLength(1);

    expect(diagnosticsToSarif(diagnostics, rules).version).toBe("2.1.0");
});
