import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileSource } from "../src/index.ts";

const portableSource = `#!/usr/bin/env bash

greet(string name="world"): status {
    printf 'Hello, %s!\\n' "$name"
}

greet
`;

for (const target of ["bash", "zsh", "sh"] as const) {
    test(`emits and executes portable typed source for ${target}`, () => {
        const root = join(import.meta.dir, `.tmp-${target}`);

        const extension = target === "zsh" ? "zsh" : "sh";

        const result = compileSource(portableSource, join(root, "main.wiz"), {
            target,
            rootDir: root,
            outDir: join(root, "dist"),
            runtimeChecks: "none",
        });

        const emitted = result.files[0];

        expect(result.diagnostics).toEqual([]);

        expect(emitted?.fileName.endsWith(`main.${extension}`)).toBe(true);

        expect(
            emitted?.code.startsWith(
                target === "sh" ? "#!/bin/sh" : `#!/usr/bin/env ${target}`,
            ),
        ).toBe(true);

        const executable = Bun.which(target);

        if (executable === null) {
            return;
        }

        const syntax = Bun.spawnSync([executable, "-n"], {
            stdin: new Blob([emitted?.code ?? ""]),
        });

        expect(syntax.stderr.toString()).toBe("");

        expect(syntax.exitCode).toBe(0);

        const execution = Bun.spawnSync([executable], {
            stdin: new Blob([emitted?.code ?? ""]),
        });

        expect(execution.exitCode).toBe(0);

        expect(execution.stdout.toString()).toBe("Hello, world!\n");
    });
}

for (const target of ["bash", "zsh", "sh"] as const) {
    test(`preserves null bytes through byte handles for ${target}`, () => {
        const executable = Bun.which(target);

        if (executable === null) {
            return;
        }

        const result = compileSource(
            `bytes capture payload -- printf 'a\\0b'
bytes length "$payload"
bytes dispose "$payload"
`,
            `/workspace/binary-${target}.wiz`,
            { target, runtimeChecks: "none" },
        );

        expect(result.diagnostics).toEqual([]);

        const execution = Bun.spawnSync([executable], {
            stdin: new Blob([result.files[0]?.code ?? ""]),
        });

        expect(execution.stderr.toString()).toBe("");

        expect(execution.exitCode).toBe(0);

        expect(execution.stdout.toString()).toBe("3\n");
    });
}

test("transpiles ordinary zsh and sh through the shared shell subset", () => {
    const zsh = compileSource(
        "name=world\nprintf 'Hello, %s!\\n' \"$name\"\n",
        "/workspace/main.zsh",
        { target: "sh", runtimeChecks: "none" },
    );

    const sh = compileSource(
        "name=world\nprintf 'Hello, %s!\\n' \"$name\"\n",
        "/workspace/main.sh",
        { target: "zsh", runtimeChecks: "none" },
    );

    expect(zsh.files[0]?.fileName.endsWith("main.sh")).toBe(true);

    expect(sh.files[0]?.fileName.endsWith("main.zsh")).toBe(true);
});

test("sh reports constructs that cannot be translated safely", () => {
    const result = compileSource(
        "declare -T string[] services=(one two)\n",
        "/workspace/main.wiz",
        { target: "sh" },
    );

    expect(result.emitSkipped).toBe(true);

    expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
            code: "WIZ5003",
            message: "arrays is not supported by the sh target",
        }),
    );
});

test("emits and executes the typed portable subset with PowerShell", () => {
    const executable = Bun.which("pwsh");

    expect(executable).not.toBeNull();

    if (executable === null) {
        return;
    }

    const result = compileSource(portableSource, "/workspace/main.wiz", {
        target: "powershell",
        runtimeChecks: "none",
    });

    expect(result.diagnostics).toEqual([]);

    expect(result.files[0]?.fileName.endsWith("main.ps1")).toBe(true);

    const execution = Bun.spawnSync([
        executable,
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        result.files[0]?.code ?? "",
    ]);

    expect(execution.stderr.toString()).toBe("");

    expect(execution.exitCode).toBe(0);

    expect(execution.stdout.toString()).toContain("Hello, world!");
});

const controlFlowSource = `declare -T string name="world"

if test "$name" = world; then
    echo yes
else
    echo no
fi

for item in a b; do
    echo "$item"
done
`;

for (const target of ["powershell", "fish"] as const) {
    test(`translates and executes portable control flow with ${target}`, () => {
        const executable = Bun.which(target === "powershell" ? "pwsh" : "fish");

        expect(executable).not.toBeNull();

        if (executable === null) {
            return;
        }

        const result = compileSource(
            controlFlowSource,
            "/workspace/control.wiz",
            {
                target,
                runtimeChecks: "none",
            },
        );

        expect(result.diagnostics).toEqual([]);

        const code = result.files[0]?.code ?? "";

        const execution =
            target === "powershell"
                ? Bun.spawnSync([
                      executable,
                      "-NoLogo",
                      "-NoProfile",
                      "-NonInteractive",
                      "-Command",
                      code,
                  ])
                : Bun.spawnSync([executable], {
                      stdin: new Blob([code]),
                  });

        expect(execution.stderr.toString()).toBe("");

        expect(execution.exitCode).toBe(0);

        expect(execution.stdout.toString()).toBe("yes\na\nb\n");
    });
}

test("typed scalar declarations do not trigger collection feature diagnostics", () => {
    for (const target of ["sh", "fish", "powershell", "cmd"] as const) {
        const result = compileSource(
            'declare -T string name="wiz"\necho "$name"\n',
            "/workspace/scalar.wiz",
            { target, runtimeChecks: "none" },
        );

        expect(result.diagnostics).toEqual([]);
    }
});

test("fish and cmd use native syntax and file extensions", () => {
    const fish = compileSource(portableSource, "/workspace/main.wiz", {
        target: "fish",
        runtimeChecks: "none",
    });

    const cmd = compileSource(portableSource, "/workspace/main.wiz", {
        target: "cmd",
        runtimeChecks: "none",
    });

    expect(fish.diagnostics).toEqual([]);

    expect(fish.files[0]?.fileName.endsWith("main.fish")).toBe(true);

    expect(fish.files[0]?.code).toContain("function greet");

    expect(cmd.diagnostics).toEqual([]);

    expect(cmd.files[0]?.fileName.endsWith("main.cmd")).toBe(true);

    expect(cmd.files[0]?.code).toStartWith("@echo off");
});

test("cmd lowers functions, variables and control flow to batch primitives", () => {
    const result = compileSource(
        `${portableSource}\n${controlFlowSource}`,
        "/workspace/native-control.wiz",
        {
            target: "cmd",
            runtimeChecks: "none",
            sourceMap: false,
        },
    );

    expect(result.diagnostics).toEqual([]);

    const code = result.files[0]?.code ?? "";

    expect(code).toContain("setlocal EnableExtensions EnableDelayedExpansion");

    expect(code).toContain('set "name=world"');

    expect(code).toContain("goto :__wiz_after_greet");

    expect(code).toContain(':greet\nset "name=%~1"');

    expect(code).toContain("call :greet");

    expect(code).toContain('if "!name!"=="world" (');

    expect(code).toContain("for %%item in (a b) do (");

    expect(code).toContain('set "item=%%item"');
});

test("cmd executes emitted functions and control flow on Windows", async () => {
    const executable = Bun.which("cmd.exe");

    if (executable === null) {
        return;
    }

    const result = compileSource(
        `${portableSource}\n${controlFlowSource}`,
        "/workspace/windows-control.wiz",
        {
            target: "cmd",
            runtimeChecks: "none",
            sourceMap: false,
        },
    );

    expect(result.diagnostics).toEqual([]);

    const directory = await mkdtemp(join(tmpdir(), "wiz-cmd-"));

    const fileName = join(directory, "control.cmd");

    try {
        await Bun.write(fileName, result.files[0]?.code ?? "");

        const execution = Bun.spawnSync([
            executable,
            "/D",
            "/Q",
            "/C",
            fileName,
        ]);

        expect(execution.stderr.toString()).toBe("");

        expect(execution.exitCode).toBe(0);

        expect(execution.stdout.toString().replaceAll("\r\n", "\n")).toBe(
            "Hello, world!\nyes\na\nb\n",
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
