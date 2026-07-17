import { expect, test } from "bun:test";
import grammar from "../syntaxes/wiz.tmLanguage.json";

test("Wiz grammar covers typed and Bash-specific syntax", () => {
    const includes = grammar.patterns.map((pattern) => {
        return pattern.include;
    });

    expect(includes).toEqual(
        expect.arrayContaining([
            "#typed-declaration",
            "#function-signature",
            "#command-declaration",
            "#environment-declaration",
            "#type-import",
            "#heredoc",
            "#arithmetic",
            "#command-substitution",
            "#parameter-expansion",
            "#process-substitution",
            "#conditionals",
            "#redirections",
        ]),
    );

    const declaration = grammar.repository["typed-declaration"].patterns[0];

    const match = new RegExp(declaration?.match ?? "").exec(
        "declare -rxT map<string, int> PORTS=([web]=8080)",
    );

    expect(match?.[1]).toBe("declare");

    expect(match?.[3]).toBe("-rxT");

    expect(match?.[5]).toBe("map<string, int>");

    expect(match?.[7]).toBe("PORTS");

    const typeImport = grammar.repository["type-import"].patterns[0];

    const importMatch = new RegExp(typeImport?.match ?? "").exec(
        'source -T "@types/python/uv"',
    );

    expect(importMatch?.[2]).toBe("source");

    expect(importMatch?.[4]).toBe("-T");

    expect(importMatch?.[7]).toBe("@types/python/uv");
});

test("Wiz grammar publishes stable semantic scope names", () => {
    const serialized = JSON.stringify(grammar);

    for (const scope of [
        "entity.name.function.wiz",
        "variable.parameter.function.wiz",
        "support.type.wiz",
        "variable.other.environment.wiz",
        "string.unquoted.heredoc.wiz",
        "meta.expansion.arithmetic.wiz",
        "keyword.operator.redirect.wiz",
        "comment.line.documentation.wiz",
        "storage.type.documentation.tag.wiz",
    ]) {
        expect(serialized).toContain(scope);
    }
});
