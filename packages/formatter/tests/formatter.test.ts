import { expect, test } from "bun:test";
import { parseSourceFile } from "@wiz/compiler";
import { formatSourceFile, minifySourceFile } from "../src/index.ts";

test("formatting is deterministic, idempotent and preserves quotes and heredocs", () => {
    const input = `#!/usr/bin/env bash   
if true; then   
echo "$HOME"   
cat <<EOF
  keep this exactly
EOF
fi
`;

    const once = formatSourceFile(parseSourceFile(input, "main.wiz"));

    const twice = formatSourceFile(parseSourceFile(once, "main.wiz"));

    expect(once).toContain('    echo "$HOME"\n');

    expect(once).toContain("  keep this exactly\n");

    expect(twice).toBe(once);
});

test("range formatting leaves lines outside the range untouched", () => {
    const input = "echo one   \necho two   \n";

    const output = formatSourceFile(
        parseSourceFile(input),
        {},
        { start: 0, end: 11 },
    );

    expect(output).toBe("echo one\necho two   \n");
});

test("range formatting derives indentation from blocks before the range", () => {
    const input = "if true; then\necho one   \necho two   \nfi\n";

    const lineStart = input.indexOf("echo two");

    const output = formatSourceFile(
        parseSourceFile(input),
        {},
        { start: lineStart, end: lineStart + "echo two   \n".length },
    );

    expect(output).toBe("if true; then\necho one   \n    echo two\nfi\n");
});

test("range formatting does not add an unrelated trailing newline", () => {
    const input = "echo one   \necho two";

    const output = formatSourceFile(
        parseSourceFile(input),
        {},
        { start: 0, end: "echo one   \n".length },
    );

    expect(output).toBe("echo one\necho two");
});

test("minification removes nonsemantic layout and preserves heredocs", () => {
    const input = `#!/usr/bin/env bash

# release builds do not need this explanation
if true; then
    echo   "hello world"   # trailing note
    cat <<EOF
  heredoc spacing stays exact
EOF
fi
`;

    const once = minifySourceFile(parseSourceFile(input, "main.sh"));

    const twice = minifySourceFile(parseSourceFile(once, "main.sh"));

    expect(once).toBe(`#!/usr/bin/env bash
if true; then
echo "hello world"
cat <<EOF
  heredoc spacing stays exact
EOF
fi
`);

    expect(twice).toBe(once);

    expect(
        Bun.spawnSync(["bash", "-n"], {
            stdin: new Blob([once]),
        }).exitCode,
    ).toBe(0);
});

test("line width wraps semantic pipeline and list boundaries idempotently", () => {
    const source =
        'printf "%s\\n" "$HOME" | grep "Projects" && printf "%s\\n" "complete"\n';

    const first = formatSourceFile(parseSourceFile(source), { lineWidth: 36 });

    const second = formatSourceFile(parseSourceFile(first), { lineWidth: 36 });

    expect(first).toBe(
        'printf "%s\\n" "$HOME" |\n    grep "Projects" &&\n    printf "%s\\n" "complete"\n',
    );

    expect(second).toBe(first);
});
