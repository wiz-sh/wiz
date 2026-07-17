import { expect, test } from "bun:test";
import { lexSource, parseSourceFile } from "../src/index.ts";

test("incomplete quotes, expansions, and heredocs stay lossless and diagnostic", () => {
    const cases = [
        { source: "printf 'open\n", code: "WIZ1001" },
        { source: 'printf "open\n', code: "WIZ1001" },
        { source: "value=$(hostname\n", code: "WIZ1002" },
        { source: "value=${HOME\n", code: "WIZ1002" },
        { source: "cat <<EOF\nbody\n", code: "WIZ1003" },
    ];

    for (const value of cases) {
        const tree = lexSource(value.source, "incomplete.wiz");

        expect(
            tree.tokens
                .map((token) => {
                    return token.text;
                })
                .join(""),
        ).toBe(value.source);

        expect(tree.diagnostics).toContainEqual(
            expect.objectContaining({ code: value.code }),
        );
    }
});

test("the parser recovers an unfinished function for editor consumers", () => {
    const source = "serve(string host): status {\n    printf '%s' \"$host\"\n";

    const file = parseSourceFile(source, "unfinished.wiz");

    expect(file.text).toBe(source);

    expect(file.diagnostics).toContainEqual(
        expect.objectContaining({
            code: "WIZ2001",
            phase: "parser",
        }),
    );
});

test("typed declarations preserve attributes, collections, and positional assertions", () => {
    const file = parseSourceFile(
        `declare -rxT path CONFIG="/etc/example"
declare -T string[] services=("web" "db")
declare -T map<string, int> ports=([web]=8080)
declare -T int "$1"
`,
        "declarations.wiz",
    );

    const declarations = file.statements.filter((statement) => {
        return statement.kind === "TypedVariableDeclaration";
    });

    expect(declarations).toHaveLength(4);

    expect(declarations[0]).toEqual(
        expect.objectContaining({
            attributes: "-rx",
            name: "CONFIG",
            type: expect.objectContaining({ name: "path" }),
        }),
    );

    expect(declarations[1]).toEqual(
        expect.objectContaining({
            type: expect.objectContaining({ name: "string[]" }),
        }),
    );

    expect(declarations[2]).toEqual(
        expect.objectContaining({
            type: expect.objectContaining({ name: "map<string, int>" }),
        }),
    );

    expect(declarations[3]).toEqual(
        expect.objectContaining({ positionalParameter: 1 }),
    );
});
