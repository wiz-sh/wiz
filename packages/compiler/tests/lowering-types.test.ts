import { expect, test } from "bun:test";
import {
    bindSourceFile,
    compileSource,
    isAssignable,
    parseSourceFile,
    parseType,
    requiredType,
} from "../src/index.ts";

test("legacy function type assertions lower without changing invocation syntax", () => {
    const source = `legacy() {
    declare -T int "$1"
    local -T string name="$2"
    printf '%s:%s\\n' "$1" "$name"
}

legacy 4 ok
`;

    const result = compileSource(source, "legacy.wiz", {
        runtimeChecks: "boundaries",
    });

    const file = parseSourceFile(source, "legacy.wiz");

    const binding = bindSourceFile(file);

    const declaration = file.statements.find((statement) => {
        return statement.kind === "FunctionDeclaration";
    });

    if (declaration === undefined) {
        throw new Error("Expected the legacy function declaration to parse");
    }

    const emitted = result.files[0]?.code ?? "";

    expect(result.diagnostics).toEqual([]);

    expect(binding.nodeScopes.get(declaration)?.resolve("1")?.type.name).toBe(
        "int",
    );

    expect(emitted).not.toContain("declare -T");

    expect(emitted).toContain("__wiz_assert_int");

    expect(emitted).toContain('local name="$2"');

    expect(
        Bun.spawnSync(["bash", "-n"], { stdin: new Blob([emitted]) }).exitCode,
    ).toBe(0);

    const execution = Bun.spawnSync(["bash"], {
        stdin: new Blob([emitted]),
    });

    expect(execution.exitCode).toBe(0);

    expect(execution.stdout.toString()).toBe("4:ok\n");

    const invalid = compileSource(
        source.replace("legacy 4 ok", "legacy wrong ok"),
        "invalid-legacy.wiz",
    );

    expect(invalid.diagnostics).toContainEqual(
        expect.objectContaining({
            code: "WIZ4001",
            message: expect.stringContaining("expects int"),
        }),
    );
});

test("runtime check modes distinguish erasure, boundaries, and all assignments", () => {
    const source = "declare -T int port=8080\n";

    const none = compileSource(source, "none.wiz", {
        runtimeChecks: "none",
    });

    const boundaries = compileSource(source, "boundaries.wiz", {
        runtimeChecks: "boundaries",
    });

    const all = compileSource(source, "all.wiz", {
        runtimeChecks: "all",
    });

    expect(none.files[0]?.code).not.toContain("__wiz_assert_int");

    expect(boundaries.files[0]?.code).not.toContain("__wiz_assert_int");

    expect(all.files[0]?.code).toContain("__wiz_assert_int");
});

test("typed arrays and maps lower with Bash attributes and validate elements", () => {
    const valid = compileSource(
        `declare -T string[] services=("web" "db")
declare -T map<string, int> ports=([web]=8080 [db]=5432)
`,
        "collections.wiz",
    );

    expect(valid.diagnostics).toEqual([]);

    expect(valid.files[0]?.code).toContain('declare -a services=("web" "db")');

    expect(valid.files[0]?.code).toContain(
        "declare -A ports=([web]=8080 [db]=5432)",
    );

    const invalid = compileSource(
        `declare -T int[] ports=(8080 "wrong")
declare -T map<string, int> retries=([web]=three)
`,
        "invalid-collections.wiz",
    );

    expect(invalid.diagnostics).toHaveLength(2);

    expect(invalid.diagnostics).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                code: "WIZ4001",
                message: expect.stringContaining("expects int elements"),
            }),
        ]),
    );
});

test("type construction and assignability cover optionals, arrays, maps, and any", () => {
    const optional = parseType("path?");

    const strings = parseType("string[]");

    const map = parseType("map<string, int>");

    expect(optional?.kind).toBe("optional");

    expect(strings?.kind).toBe("array");

    expect(map?.kind).toBe("map");

    expect(isAssignable(requiredType("path"), requiredType("string"))).toBe(
        true,
    );

    expect(isAssignable(requiredType("void"), requiredType("path?"))).toBe(
        true,
    );

    expect(
        isAssignable(
            requiredType("map<string, int>"),
            requiredType("map<string, int>"),
        ),
    ).toBe(true);

    expect(isAssignable(requiredType("any"), requiredType("int"))).toBe(true);
});

test("bytes preserve nulls outside shell variables and reject accidental interpolation", () => {
    const source = `bytes capture payload -- printf 'left\\0right'
bytes length "$payload"
bytes emit "$payload"
bytes dispose "$payload"
`;

    const file = parseSourceFile(source, "binary.wiz");

    const binding = bindSourceFile(file);

    expect(binding.globalScope.resolve("payload")?.type.name).toBe("bytes");

    const result = compileSource(source, "binary.wiz", {
        runtimeChecks: "none",
    });

    expect(result.diagnostics).toEqual([]);

    const emitted = result.files[0]?.code ?? "";

    expect(emitted).toContain("__wiz_bytes_capture");

    expect(
        Bun.spawnSync(["bash", "-n"], {
            stdin: new Blob([emitted]),
        }).exitCode,
    ).toBe(0);

    const execution = Bun.spawnSync(["bash"], {
        stdin: new Blob([emitted]),
    });

    expect(execution.exitCode).toBe(0);

    const expected = new TextEncoder().encode("10\nleft\0right");

    expect([...execution.stdout]).toEqual([...expected]);

    const invalid = compileSource(
        `bytes capture payload -- printf 'a\\0b'
printf '%s\\n' "$payload"
`,
        "invalid-binary.wiz",
    );

    expect(invalid.diagnostics).toContainEqual(
        expect.objectContaining({
            code: "WIZ4005",
            message: expect.stringContaining("bytes emit"),
        }),
    );
});
