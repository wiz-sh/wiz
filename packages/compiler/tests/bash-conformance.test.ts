import { expect, test } from "bun:test";
import { compileSource, lexSource, parseSourceFile } from "../src/index.ts";

const bashSource = `#!/usr/bin/env bash

set -euo pipefail

declare -a services=(web db)
declare -A ports=([web]=8080 [db]=5432)

render() {
    local service

    for service in "\${services[@]}"; do
        case "$service" in
            web)
                printf '%s:%s\\n' "$service" "\${ports[$service]}"
                ;;
            *)
                printf '%s:%s\\n' "$service" "\${ports[$service]}"
                ;;
        esac
    done
}

count=0

while ((count < 1)); do
    ((count += 1))
done

if [[ "$count" -eq 1 ]]; then
    render
fi

read -r first < <(printf '%s\\n' process)
printf '%s\\n' "$first"

cat <<'MESSAGE'
heredoc text
MESSAGE
`;

function execute(source: string): {
    stdout: string;
    stderr: string;
    exitCode: number;
} {
    const processHandle = Bun.spawnSync(["bash"], {
        stdin: new Blob([source]),
        stdout: "pipe",
        stderr: "pipe",
    });

    return {
        stdout: processHandle.stdout.toString(),
        stderr: processHandle.stderr.toString(),
        exitCode: processHandle.exitCode,
    };
}

test("ordinary Bash preserves behavior through the Wiz compiler", () => {
    const result = compileSource(bashSource, "conformance.wiz", {
        runtimeChecks: "boundaries",
    });

    const emitted = result.files[0]?.code ?? "";

    expect(result.diagnostics).toEqual([]);

    expect(
        Bun.spawnSync(["bash", "-n"], { stdin: new Blob([emitted]) }).exitCode,
    ).toBe(0);

    expect(execute(emitted)).toEqual(execute(bashSource));
});

test("lexer covers expansions, arithmetic, conditionals, heredocs, and quotes", () => {
    const tree = lexSource(bashSource, "conformance.wiz");

    const modes = new Set(
        tree.tokens.map((token) => {
            return token.mode;
        }),
    );

    expect(modes.size).toBeGreaterThan(3);

    expect(modes.has("arithmetic")).toBe(true);

    expect(modes.has("conditional")).toBe(true);

    expect(modes.has("heredoc")).toBe(true);

    expect(modes.has("double-quoted")).toBe(true);

    expect(tree.diagnostics).toEqual([]);
});

test("semantic command syntax models lists, pipelines, redirections, and expansions", () => {
    const file = parseSourceFile(
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell expansion fixture
        'printf "%s\\n" "${HOME}" 2>errors.log | grep wiz && echo "$(pwd)"\n',
        "syntax.wiz",
    );

    const statement = file.statements[0];

    expect(statement).toEqual(
        expect.objectContaining({
            kind: "CommandStatement",
            syntax: expect.objectContaining({
                operators: ["&&"],
                pipelines: [
                    expect.objectContaining({
                        operators: ["|"],
                        commands: [
                            expect.objectContaining({
                                redirections: [
                                    expect.objectContaining({
                                        descriptor: 2,
                                        operator: ">",
                                    }),
                                ],
                            }),
                            expect.objectContaining({
                                words: expect.any(Array),
                            }),
                        ],
                    }),
                    expect.objectContaining({
                        commands: [
                            expect.objectContaining({
                                words: expect.arrayContaining([
                                    expect.objectContaining({
                                        parts: expect.arrayContaining([
                                            expect.objectContaining({
                                                partKind:
                                                    "command-substitution",
                                            }),
                                        ]),
                                    }),
                                ]),
                            }),
                        ],
                    }),
                ],
            }),
        }),
    );
});
