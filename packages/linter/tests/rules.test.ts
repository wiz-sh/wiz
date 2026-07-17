import { expect, test } from "bun:test";
import { parseSourceFile } from "@wiz/compiler";
import { applyLintFixes, lintSourceFile } from "../src/index.ts";

function diagnostics(source: string) {
    return lintSourceFile(parseSourceFile(source, "rules.wiz"));
}

function ruleNames(source: string): string[] {
    return diagnostics(source).map((diagnostic) => {
        return diagnostic.rule;
    });
}

test("typed function bodies validate positional parameters", () => {
    const source = `task(string name): status {
    printf '%s\\n' "$2"
}
`;

    expect(ruleNames(source)).toContain(
        "correctness/no-invalid-positional-parameter",
    );

    expect(ruleNames(source.replace("$2", "$1"))).not.toContain(
        "correctness/no-invalid-positional-parameter",
    );
});

test("impossible typed comparisons and empty conditions are reported", () => {
    const source = `declare -T bool enabled=true
[[ "$enabled" == 42 ]]
[[ ]]
`;

    const names = ruleNames(source);

    expect(names).toContain("correctness/no-impossible-type-check");

    expect(names).toContain("suspicious/no-empty-condition");
});

test("ignored statuses and discarded substitutions are reported", () => {
    const source = `ready(): status {
    return 0
}
ready
$(hostname)
printf '%s\\n' done
`;

    const names = ruleNames(source);

    expect(names).toContain("suspicious/no-ignored-status");

    expect(names).toContain("suspicious/no-useless-command-substitution");
});

test("untyped function assignments receive distinct unsafe fixes", () => {
    const source = `work() {
    value=1
    printf '%s\\n' "$value"
}
`;

    const result = diagnostics(source);

    expect(result).toContainEqual(
        expect.objectContaining({
            rule: "suspicious/no-implicit-any",
        }),
    );

    const preferLocal = result.find((diagnostic) => {
        return diagnostic.rule === "style/prefer-local";
    });

    expect(preferLocal?.fix?.safe).toBe(false);

    expect(
        applyLintFixes(source, preferLocal === undefined ? [] : [preferLocal]),
    ).toBe(source);

    expect(
        applyLintFixes(
            source,
            preferLocal === undefined ? [] : [preferLocal],
            true,
        ),
    ).toContain("local value=1");
});

test("plain declare and single brackets have precise style diagnostics", () => {
    const source = `declare value=1
[ "$value" = 1 ]
`;

    const result = diagnostics(source);

    expect(result).toContainEqual(
        expect.objectContaining({
            rule: "style/no-redundant-declare",
            range: { start: 0, end: 7 },
        }),
    );

    const brackets = result.find((diagnostic) => {
        return diagnostic.rule === "style/prefer-double-brackets";
    });

    expect(brackets?.fix?.safe).toBe(false);

    expect(
        applyLintFixes(source, brackets === undefined ? [] : [brackets], true),
    ).toContain('[[ "$value" = 1 ]]');
});

test("rule severity overrides disable individual diagnostics", () => {
    const file = parseSourceFile("eval dangerous\n", "rules.wiz");

    expect(
        lintSourceFile(file, {
            rules: {
                "safety/no-eval": "off",
            },
        }).some((diagnostic) => {
            return diagnostic.rule === "safety/no-eval";
        }),
    ).toBe(false);
});

test("fix application skips overlapping and invalid edits", () => {
    const fixed = applyLintFixes("abcdef", [
        {
            rule: "test/outer",
            category: "style",
            severity: "warning",
            message: "outer",
            fileName: "test.wiz",
            range: { start: 1, end: 5 },
            fix: { range: { start: 1, end: 5 }, text: "X", safe: true },
        },
        {
            rule: "test/inner",
            category: "style",
            severity: "warning",
            message: "inner",
            fileName: "test.wiz",
            range: { start: 2, end: 3 },
            fix: { range: { start: 2, end: 3 }, text: "Y", safe: true },
        },
        {
            rule: "test/invalid",
            category: "style",
            severity: "warning",
            message: "invalid",
            fileName: "test.wiz",
            range: { start: -1, end: 0 },
            fix: { range: { start: -1, end: 0 }, text: "Z", safe: true },
        },
    ]);

    expect(fixed).toBe("abYdef");
});
