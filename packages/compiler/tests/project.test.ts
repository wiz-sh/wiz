import { expect, test } from "bun:test";
import { resolve } from "node:path";
import {
    type CompilerHost,
    createProgram,
    emitProgram,
    getDiagnostics,
    IncrementalCompiler,
} from "../src/index.ts";

function host(files: Readonly<Record<string, string>>): CompilerHost {
    return {
        readFile(path) {
            return files[resolve(path)];
        },
        fileExists(path) {
            return files[resolve(path)] !== undefined;
        },
        resolvePath(specifier, containingFile) {
            return resolve(containingFile, "..", specifier);
        },
    };
}

test("project graphs follow Wiz sources and legacy declarations", () => {
    const files = {
        [resolve("/project/main.wiz")]:
            'source "./helpers.wiz"\nsource "./legacy.sh"\nhelper "ok"\n',
        [resolve("/project/helpers.wiz")]:
            "helper(string value): status {\n    printf '%s\\n' \"$value\"\n}\n",
        [resolve("/project/legacy.d.wiz")]: "declare env LEGACY_HOME: path\n",
    };

    const program = createProgram(
        ["/project/main.wiz"],
        {
            checkSourcedFiles: true,
            checkDeclarationFiles: true,
        },
        host(files),
    );

    const emitted = emitProgram(program);

    expect(
        program.sourceFiles
            .map((file) => {
                return file.fileName;
            })
            .sort(),
    ).toEqual([
        "/project/helpers.wiz",
        "/project/legacy.d.wiz",
        "/project/main.wiz",
    ]);

    expect(getDiagnostics(program)).toEqual([]);

    expect(
        emitted.files.find((file) => {
            return file.sourceFile === "/project/main.wiz";
        })?.code,
    ).toContain("helpers.sh");

    expect(
        emitted.files.find((file) => {
            return file.sourceFile.endsWith(".d.wiz");
        })?.code,
    ).toBeUndefined();
});

test("type-only sources load installed package aggregates and emit nothing", () => {
    const files = {
        [resolve("/project/main.wiz")]:
            'source -T "@types/python"\nuv run pytest\n',
        [resolve("/project/wiz_modules/@types/python/index.d.wiz")]:
            'source "./uv.d.wiz"\n',
        [resolve("/project/wiz_modules/@types/python/uv.d.wiz")]:
            "declare command uv {\n    run(command: string, ...arguments: string[]): status\n}\n",
    };

    const program = createProgram(
        ["/project/main.wiz"],
        {
            projectRoot: "/project",
        },
        host(files),
    );

    const diagnostics = getDiagnostics(program);

    expect(diagnostics).toEqual([]);

    expect(
        program.bindings.get("/project/main.wiz")?.globalScope.resolve("uv"),
    ).toBeDefined();

    const output = emitProgram(program).files.find((file) => {
        return file.sourceFile === "/project/main.wiz";
    })?.code;

    expect(output).not.toContain("source -T");

    expect(output).toContain("uv run pytest");
});

test("type-only sources report packages that are not installed", () => {
    const files = {
        [resolve("/project/main.wiz")]: 'source -T "@types/missing"\n',
    };

    const program = createProgram(
        ["/project/main.wiz"],
        {
            projectRoot: "/project",
        },
        host(files),
    );

    expect(getDiagnostics(program)).toContainEqual(
        expect.objectContaining({
            code: "WIZ5002",
            message: "Type package was not found: @types/missing",
        }),
    );
});

test("scoped sources import only explicitly exported module symbols", () => {
    const files = {
        [resolve("/project/main.wiz")]:
            'source -I name greet -- "./helpers.wiz"\nprintf \'%s\\n\' "$name"\ngreet "Wiz"\nif declare -p secret >/dev/null 2>&1; then exit 9; fi\n',
        [resolve("/project/helpers.wiz")]:
            'declare -T string name="Hazel"\ndeclare -T string secret="private"\ngreet(string value): void {\n    printf \'Hello, %s!\\n\' "$value"\n}\nexport name\nexport -f greet\n',
    };

    const program = createProgram(
        ["/project/main.wiz"],
        {
            bundle: true,
            runtimeChecks: "none",
            sourceMap: false,
        },
        host(files),
    );

    expect(getDiagnostics(program)).toEqual([]);

    const mainBinding = program.bindings.get("/project/main.wiz");

    expect(mainBinding?.globalScope.resolve("name")).toBeDefined();

    expect(mainBinding?.globalScope.resolve("greet")).toBeDefined();

    expect(mainBinding?.globalScope.resolve("secret")).toBeUndefined();

    const result = emitProgram(program);

    expect(result.files).toHaveLength(1);

    const execution = Bun.spawnSync(["bash"], {
        stdin: new Blob([result.files[0]?.code ?? ""]),
    });

    expect(execution.exitCode).toBe(0);

    expect(execution.stdout.toString()).toBe("Hazel\nHello, Wiz!\n");

    const unsupportedTarget = createProgram(
        ["/project/main.wiz"],
        { target: "zsh" },
        host(files),
    );

    expect(getDiagnostics(unsupportedTarget)).toContainEqual(
        expect.objectContaining({
            code: "WIZ5003",
            message: "scoped-import is not supported by the zsh target",
        }),
    );

    const unavailable = createProgram(
        ["/project/main.wiz"],
        {},
        host({
            ...files,
            [resolve("/project/main.wiz")]:
                'source -I secret -- "./helpers.wiz"\n',
        }),
    );

    expect(getDiagnostics(unavailable)).toContainEqual(
        expect.objectContaining({
            code: "WIZ3004",
            message: "Module does not export secret",
        }),
    );
});

test("missing and dynamic source paths produce configurable diagnostics", () => {
    const files = {
        [resolve("/project/main.wiz")]:
            'source "./missing.wiz"\nsource "$PLUGIN"\nsource "./legacy.sh"\n',
    };

    const checked = createProgram(
        ["/project/main.wiz"],
        {
            checkSourcedFiles: true,
            checkDeclarationFiles: true,
        },
        host(files),
    );

    expect(getDiagnostics(checked)).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ code: "WIZ5001" }),
            expect.objectContaining({
                code: "WIZ5002",
                severity: "error",
            }),
            expect.objectContaining({
                code: "WIZ5002",
                severity: "warning",
            }),
        ]),
    );

    const unchecked = createProgram(
        ["/project/main.wiz"],
        {
            checkSourcedFiles: false,
            checkDeclarationFiles: false,
        },
        host(files),
    );

    expect(
        getDiagnostics(unchecked).filter((diagnostic) => {
            return diagnostic.code === "WIZ5002";
        }),
    ).toEqual([]);
});

test("bundling inlines typed and legacy static sources into one executable", () => {
    const files = {
        [resolve("/project/main.wiz")]:
            'source "./helpers.wiz"\nsource "./legacy.sh"\ngreet "Wiz"\nlegacy\n',
        [resolve("/project/helpers.wiz")]:
            "greet(string name): status {\n    printf 'Hello, %s!\\n' \"$name\"\n}\n",
        [resolve("/project/legacy.sh")]:
            "legacy() {\n    printf 'Legacy!\\n'\n}\n",
    };

    const program = createProgram(
        ["/project/main.wiz"],
        {
            bundle: true,
            minify: true,
            noEmitOnError: true,
            runtimeChecks: "none",
            sourceMap: false,
        },
        host(files),
    );

    const result = emitProgram(program);

    expect(result.diagnostics).toEqual([]);

    expect(result.files).toHaveLength(1);

    expect(result.files[0]?.code).not.toContain("source ");

    expect(result.files[0]?.code).toContain("greet()");

    const execution = Bun.spawnSync(["bash"], {
        stdin: new Blob([result.files[0]?.code ?? ""]),
    });

    expect(execution.exitCode).toBe(0);

    expect(execution.stdout.toString()).toBe("Hello, Wiz!\nLegacy!\n");
});

test("bundling diagnoses missing and circular static sources", () => {
    const files = {
        [resolve("/project/main.wiz")]: 'source "./cycle.wiz"\n',
        [resolve("/project/cycle.wiz")]:
            'source "./main.wiz"\nsource "./missing.sh"\n',
    };

    const program = createProgram(
        ["/project/main.wiz"],
        { bundle: true },
        host(files),
    );

    expect(getDiagnostics(program)).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ code: "WIZ5002", severity: "error" }),
            expect.objectContaining({ code: "WIZ5004", severity: "error" }),
        ]),
    );

    expect(emitProgram(program).emitSkipped).toBe(true);
});

test("incremental programs retain unchanged syntax and semantic trees", () => {
    const files = {
        [resolve("/project/main.wiz")]: 'source "./helper.wiz"\nhelper\n',
        [resolve("/project/helper.wiz")]: "helper(): status { return 0; }\n",
    };

    const compiler = new IncrementalCompiler(host(files));

    const first = compiler.createProgram(["/project/main.wiz"]);

    const firstMain = first.sourceFiles.find((file) => {
        return file.fileName === "/project/main.wiz";
    });

    compiler.updateFile(
        "/project/helper.wiz",
        "helper(): status { return 1; }\n",
    );

    const second = compiler.createProgram(["/project/main.wiz"]);

    const secondMain = second.sourceFiles.find((file) => {
        return file.fileName === "/project/main.wiz";
    });

    expect(secondMain).toBe(firstMain);

    expect(
        second.sourceFiles.find((file) => {
            return file.fileName === "/project/helper.wiz";
        }),
    ).not.toBe(
        first.sourceFiles.find((file) => {
            return file.fileName === "/project/helper.wiz";
        }),
    );
});
