import { expect, test } from "bun:test";
import { compileSource } from "../src/index.ts";

test("typed reassignments preserve declared variable types", () => {
    const valid = compileSource(
        `declare -T int attempts=1
attempts=2
`,
        "valid-assignment.wiz",
    );

    const invalid = compileSource(
        `declare -T int attempts=1
attempts=wrong
`,
        "invalid-assignment.wiz",
    );

    expect(valid.diagnostics).toEqual([]);

    expect(invalid.diagnostics).toContainEqual(
        expect.objectContaining({
            code: "WIZ4001",
            message: "Cannot assign string to int attempts",
        }),
    );
});

test("arithmetic rejects typed nonnumeric operands", () => {
    const result = compileSource(
        `declare -T string service="web"
((service++))
`,
        "arithmetic.wiz",
    );

    expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
            code: "WIZ4001",
            message:
                "Arithmetic operand service must be numeric-compatible, but has type string",
        }),
    );
});

test("untyped assignments remain valid Bash and bind as permissive values", () => {
    const result = compileSource(
        `message=hello
printf '%s\\n' "$message"
`,
        "untyped.wiz",
    );

    expect(result.diagnostics).toEqual([]);

    expect(result.files[0]?.code).toContain("message=hello");
});

test("strictness options control any and unknown boundary behavior", () => {
    const explicitAny = compileSource(
        "declare -T any value=1\n",
        "explicit-any.wiz",
        { allowAny: false },
    );

    const implicitAny = compileSource("value=1\n", "implicit-any.wiz", {
        strict: false,
        implicitAny: false,
    });

    const unknownArithmetic = compileSource(
        "value=1\n((value++))\n",
        "unknown-arithmetic.wiz",
        { strict: true },
    );

    expect(explicitAny.diagnostics).toContainEqual(
        expect.objectContaining({
            code: "WIZ4004",
            message: "Explicit any is disabled for value",
        }),
    );

    expect(implicitAny.diagnostics).toContainEqual(
        expect.objectContaining({
            code: "WIZ4004",
            message: "Variable value is inferred with type any",
        }),
    );

    expect(unknownArithmetic.diagnostics).toContainEqual(
        expect.objectContaining({
            code: "WIZ4001",
            message:
                "Arithmetic operand value must be numeric-compatible, but has type unknown",
        }),
    );
});

test("unknown command policy supports allow, warning, and error", () => {
    const source = "custom_tool run\n";

    expect(
        compileSource(source, "allow.wiz", {
            unknownCommands: "allow",
        }).diagnostics,
    ).toEqual([]);

    expect(
        compileSource(source, "warning.wiz", {
            unknownCommands: "warning",
        }).diagnostics,
    ).toContainEqual(
        expect.objectContaining({
            code: "WIZ3002",
            severity: "warning",
        }),
    );

    expect(
        compileSource(source, "error.wiz", {
            unknownCommands: "error",
        }).diagnostics,
    ).toContainEqual(
        expect.objectContaining({
            code: "WIZ3002",
            severity: "error",
        }),
    );
});

test("typed signatures validate defaults, ordering, and result channels", () => {
    const result = compileSource(
        `invalid(int first="wrong", string optional="ok", int required): int {
    return 0
}
`,
        "signature.wiz",
    );

    expect(result.diagnostics).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                code: "WIZ4001",
                message: "Default for first expects int, but received string",
            }),
            expect.objectContaining({
                code: "WIZ4004",
                message:
                    "Required parameter required cannot follow an optional parameter",
            }),
            expect.objectContaining({
                code: "WIZ4004",
                message: "Function invalid has unsupported result type int",
            }),
        ]),
    );
});
