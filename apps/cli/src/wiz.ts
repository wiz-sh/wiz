import { watch } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
    createProgram,
    emitProgram,
    getDiagnostics,
    parseSourceFile,
} from "@wiz/compiler";
import { loadConfig, type WizConfig } from "@wiz/config";
import { formatSourceFile, minifySourceFile } from "@wiz/formatter";
import { applyLintFixes, lintSourceFile } from "@wiz/linter";
import { serveStdio } from "@wiz/lsp";
import { WizError } from "@wiz/pm";
import { mapPosition } from "./source-map.ts";

export const COMPILER_HELP = `Usage: wiz c <command> [options]

Commands:
  init
  build [file] [--target bash|zsh|sh|fish|powershell|cmd] [--bundle] [--minify]
  check [file] [--target bash|zsh|sh|fish|powershell|cmd]
  run <file> [-- args...]
  watch [file]
  format [--write|--check|--minify] <path...>
  lint [--fix|--fix-unsafe] <path...>
  lsp --stdio
  config
  map <generated.sh:line>`;

function rejectUnknownOptions(
    command: string,
    args: readonly string[],
    allowed: readonly string[] = [],
): void {
    const supported = new Set(allowed);

    const unknown = args.find((argument) => {
        return argument.startsWith("-") && !supported.has(argument);
    });

    if (unknown !== undefined) {
        throw new WizError(`Unknown option for wiz c ${command}: ${unknown}`);
    }
}

function isShellSource(path: string): boolean {
    return (
        path.endsWith(".wiz") || path.endsWith(".zsh") || path.endsWith(".sh")
    );
}

async function filesInside(path: string): Promise<string[]> {
    const absolute = resolve(path);

    const info = await stat(absolute).catch(() => {
        return undefined;
    });

    if (info === undefined) {
        throw new WizError(`Path not found: ${path}`);
    }

    if (info.isFile()) {
        return isShellSource(absolute) ? [absolute] : [];
    }

    const result: string[] = [];

    for (const entry of await readdir(absolute, { withFileTypes: true })) {
        if (
            ["dist", "node_modules", "wiz_modules", ".git"].includes(entry.name)
        ) {
            continue;
        }

        const child = join(absolute, entry.name);

        if (entry.isDirectory()) {
            result.push(...(await filesInside(child)));
        } else if (entry.isFile() && isShellSource(entry.name)) {
            result.push(child);
        }
    }

    return result;
}

async function inputFiles(
    args: readonly string[],
    config: WizConfig,
): Promise<string[]> {
    const paths = args.filter((argument) => {
        return !argument.startsWith("-");
    });

    if (paths.length === 0) {
        const files = new Set<string>();

        const excludes = config.files.exclude.map((pattern) => {
            return new Bun.Glob(pattern);
        });

        for (const pattern of config.files.include) {
            const glob = new Bun.Glob(pattern);

            for await (const path of glob.scan({
                cwd: config.projectRoot,
                dot: false,
                onlyFiles: true,
            })) {
                if (
                    isShellSource(path) &&
                    !excludes.some((exclude) => {
                        return exclude.match(path);
                    })
                ) {
                    files.add(resolve(config.projectRoot, path));
                }
            }
        }

        return [...files].toSorted();
    }

    const files = new Set<string>();

    for (const path of paths) {
        for (const file of await filesInside(path)) {
            files.add(file);
        }
    }

    return [...files].toSorted();
}

function reportConfigDiagnostics(
    loaded: Awaited<ReturnType<typeof loadConfig>>,
): boolean {
    for (const diagnostic of loaded.diagnostics) {
        console.error(`${diagnostic.code} ${diagnostic.message}`);
    }

    return loaded.diagnostics.some((diagnostic) => {
        return diagnostic.severity === "error";
    });
}

function compilerOptions(config: WizConfig) {
    return {
        target: config.compiler.target,
        rootDir: config.compiler.rootDir,
        outDir: config.compiler.outDir,
        sourceMap: config.compiler.sourceMap,
        noEmitOnError: config.compiler.noEmitOnError,
        runtimeChecks: config.compiler.runtimeChecks,
        strict: config.typeChecking.strict,
        allowAny: config.typeChecking.allowAny,
        implicitAny: config.typeChecking.implicitAny,
        unknownCommands: config.typeChecking.unknownCommands,
        checkSourcedFiles: config.typeChecking.checkSourcedFiles,
        checkDeclarationFiles: config.typeChecking.checkDeclarationFiles,
        types: config.typeChecking.types,
        projectRoot: config.projectRoot,
        bundle: config.compiler.bundle,
        minify: config.compiler.minify,
    } as const;
}

function printDiagnostics(program: ReturnType<typeof createProgram>): boolean {
    const diagnostics = getDiagnostics(program);

    for (const diagnostic of diagnostics) {
        const file = program.sourceFiles.find((source) => {
            return source.fileName === diagnostic.fileName;
        });

        const position = file?.syntaxTree.source.positionAt(
            diagnostic.range.start,
        );

        console.error(
            `${diagnostic.fileName}:${(position?.line ?? 0) + 1}:${(position?.column ?? 0) + 1} ${diagnostic.code} ${diagnostic.message}`,
        );
    }

    return diagnostics.some((diagnostic) => {
        return diagnostic.severity === "error";
    });
}

async function writeEmitted(
    program: ReturnType<typeof createProgram>,
): Promise<number> {
    const result = emitProgram(program);

    if (printDiagnostics(program) || result.emitSkipped) {
        return 1;
    }

    for (const file of result.files) {
        await mkdir(dirname(file.fileName), { recursive: true });

        await writeFile(file.fileName, file.code);

        if (file.mapText !== undefined) {
            await writeFile(`${file.fileName}.map`, file.mapText);
        }
    }

    return 0;
}

async function initWiz(): Promise<number> {
    const configPath = resolve("config.wiz.json");

    if (await Bun.file(configPath).exists()) {
        throw new WizError("config.wiz.json already exists");
    }

    const config = {
        compiler: {
            target: "bash",
            rootDir: "./src",
            outDir: "./dist",
            sourceMap: true,
            noEmitOnError: true,
            runtimeChecks: "boundaries",
            bundle: false,
            minify: false,
        },
        typeChecking: {
            strict: true,
            allowAny: false,
            implicitAny: false,
            unknownCommands: "warning",
            checkSourcedFiles: true,
            checkDeclarationFiles: true,
            types: [],
        },
        formatter: {
            indentStyle: "space",
            indentWidth: 4,
            lineWidth: 100,
            quoteStyle: "preserve",
            trailingNewline: true,
        },
        linter: { enabled: true, recommended: true, rules: {} },
        files: {
            include: ["src/**/*.wiz", "src/**/*.d.wiz"],
            exclude: ["dist/**", "node_modules/**", "wiz_modules/**"],
        },
    };

    await mkdir(resolve("src"), { recursive: true });

    await writeFile(configPath, `${JSON.stringify(config, null, 4)}\n`);

    const main = resolve("src/main.wiz");

    if (!(await Bun.file(main).exists())) {
        await writeFile(
            main,
            '#!/usr/bin/env bash\n\ndeclare -T string name="world"\nprintf \'Hello, %s!\\n\' "$name"\n',
        );
    }

    console.log(`Created ${configPath}`);

    return 0;
}

async function buildOrCheck(
    args: readonly string[],
    emit: boolean,
): Promise<number> {
    const loaded = await loadConfig();

    if (reportConfigDiagnostics(loaded)) {
        return 1;
    }

    const targetIndex = args.indexOf("--target");

    const requestedTarget = targetIndex < 0 ? undefined : args[targetIndex + 1];

    if (
        requestedTarget !== undefined &&
        !["bash", "zsh", "sh", "fish", "powershell", "cmd"].includes(
            requestedTarget,
        )
    ) {
        throw new WizError(`Unsupported shell target: ${requestedTarget}`);
    }

    if (targetIndex >= 0 && requestedTarget === undefined) {
        throw new WizError(
            "--target requires bash, zsh, sh, fish, powershell, or cmd",
        );
    }

    const paths = args.filter((argument, index) => {
        if (["--bundle", "--minify"].includes(argument)) {
            return false;
        }

        return index !== targetIndex && index !== targetIndex + 1;
    });

    const files = await inputFiles(paths, loaded.config);

    if (files.length === 0) {
        throw new WizError(
            `No Wiz files matched: ${loaded.config.files.include.join(", ")}`,
        );
    }

    const program = createProgram(files, {
        ...compilerOptions(loaded.config),
        target:
            (requestedTarget as
                | "bash"
                | "zsh"
                | "sh"
                | "fish"
                | "powershell"
                | "cmd"
                | undefined) ?? loaded.config.compiler.target,
        bundle: args.includes("--bundle") || loaded.config.compiler.bundle,
        minify: args.includes("--minify") || loaded.config.compiler.minify,
    });

    return emit ? writeEmitted(program) : printDiagnostics(program) ? 1 : 0;
}

async function runWiz(args: readonly string[]): Promise<number> {
    const separator = args.indexOf("--");

    const file = args[0];

    if (file === undefined) {
        throw new WizError("Missing Wiz source file");
    }

    const loaded = await loadConfig();

    if (reportConfigDiagnostics(loaded)) {
        return 1;
    }

    const program = createProgram(
        [resolve(file)],
        compilerOptions(loaded.config),
    );

    const code = await writeEmitted(program);

    if (code !== 0) {
        return code;
    }

    const emitted = emitProgram(program).files.find((result) => {
        return result.sourceFile === resolve(file);
    });

    if (emitted === undefined) {
        throw new WizError(`No Bash output for ${file}`);
    }

    const forwarded = separator < 0 ? args.slice(1) : args.slice(separator + 1);

    const child = Bun.spawn(
        [loaded.config.compiler.target, emitted.fileName, ...forwarded],
        {
            cwd: process.cwd(),
            env: process.env,
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
        },
    );

    return child.exited;
}

async function formatFiles(args: readonly string[]): Promise<number> {
    rejectUnknownOptions("format", args, [
        "--check",
        "--minify",
        "--write",
        "--stdin-file-path",
    ]);

    const check = args.includes("--check");

    const minify = args.includes("--minify");

    const write = args.includes("--write") || !check;

    if (check && args.includes("--write")) {
        throw new WizError("--check and --write cannot be used together");
    }

    const stdinIndex = args.indexOf("--stdin-file-path");

    if (stdinIndex >= 0 && args[stdinIndex + 1] === undefined) {
        throw new WizError("--stdin-file-path requires a source filename");
    }

    const loaded = await loadConfig();

    if (reportConfigDiagnostics(loaded)) {
        return 1;
    }

    if (stdinIndex >= 0) {
        const fileName = args[stdinIndex + 1] ?? "stdin.wiz";

        const sourceFile = parseSourceFile(await Bun.stdin.text(), fileName);

        process.stdout.write(
            minify
                ? minifySourceFile(sourceFile)
                : formatSourceFile(sourceFile, loaded.config.formatter),
        );

        return 0;
    }

    const paths = args.filter((argument) => {
        return !["--check", "--minify", "--write"].includes(argument);
    });

    const files = await inputFiles(paths, loaded.config);

    let changed = false;

    for (const file of files) {
        const source = await Bun.file(file).text();

        const sourceFile = parseSourceFile(source, file);

        const formatted = minify
            ? minifySourceFile(sourceFile)
            : formatSourceFile(sourceFile, loaded.config.formatter);

        if (formatted !== source) {
            changed = true;

            if (write) {
                await writeFile(file, formatted);
            } else {
                console.error(`${file} is not formatted`);
            }
        }
    }

    return check && changed ? 1 : 0;
}

async function lintFiles(args: readonly string[]): Promise<number> {
    rejectUnknownOptions("lint", args, ["--fix", "--fix-unsafe"]);

    if (args.includes("--fix") && args.includes("--fix-unsafe")) {
        throw new WizError("--fix and --fix-unsafe cannot be used together");
    }

    const fix = args.includes("--fix") || args.includes("--fix-unsafe");

    const unsafe = args.includes("--fix-unsafe");

    const loaded = await loadConfig();

    if (reportConfigDiagnostics(loaded)) {
        return 1;
    }

    if (!loaded.config.linter.enabled) {
        return 0;
    }

    const paths = args.filter((argument) => {
        return !["--fix", "--fix-unsafe"].includes(argument);
    });

    const files = await inputFiles(paths, loaded.config);

    const collectResults = () => {
        const program = createProgram(files, compilerOptions(loaded.config));

        return files.map((file) => {
            const sourceFile = program.sourceFiles.find((candidate) => {
                return candidate.fileName === file;
            });

            const binding = program.bindings.get(file);

            if (sourceFile === undefined || binding === undefined) {
                throw new WizError(`Unable to lint source file: ${file}`);
            }

            return {
                file,
                sourceFile,
                diagnostics: lintSourceFile(
                    sourceFile,
                    {
                        recommended: loaded.config.linter.recommended,
                        rules: loaded.config.linter.rules,
                    },
                    binding,
                ),
            };
        });
    };

    let results = collectResults();

    if (fix) {
        let changed = false;

        for (const result of results) {
            const fixed = applyLintFixes(
                result.sourceFile.text,
                result.diagnostics,
                unsafe,
            );

            if (fixed !== result.sourceFile.text) {
                await writeFile(result.file, fixed);

                changed = true;
            }
        }

        if (changed) {
            // Rebinding after fixes keeps sourced-file symbols and ranges current.
            results = collectResults();
        }
    }

    let errors = 0;

    for (const result of results) {
        for (const diagnostic of result.diagnostics) {
            const position = result.sourceFile.syntaxTree.source.positionAt(
                diagnostic.range.start,
            );

            console.error(
                `${result.file}:${position.line + 1}:${position.column + 1} ${diagnostic.severity} ${diagnostic.rule} ${diagnostic.message}`,
            );

            if (diagnostic.severity === "error") {
                errors += 1;
            }
        }
    }

    return errors > 0 ? 1 : 0;
}

async function watchWiz(args: readonly string[]): Promise<number> {
    rejectUnknownOptions("watch", args, ["--run"]);

    const loaded = await loadConfig();

    if (reportConfigDiagnostics(loaded)) {
        return 1;
    }

    const separator = args.indexOf("--");

    const compilerArguments = args
        .slice(0, separator < 0 ? args.length : separator)
        .filter((argument) => {
            return argument !== "--run";
        });

    const forwarded = separator < 0 ? [] : args.slice(separator + 1);

    const execute = args
        .slice(0, separator < 0 ? args.length : separator)
        .includes("--run");

    const watchedFiles = await inputFiles(compilerArguments, loaded.config);

    if (execute && watchedFiles.length !== 1) {
        throw new WizError(
            "wiz watch needs one entry file; pass a .wiz file explicitly",
        );
    }

    let child: ReturnType<typeof Bun.spawn> | undefined;

    const restart = async (): Promise<void> => {
        if (!execute) {
            return;
        }

        if (child !== undefined) {
            child.kill("SIGTERM");

            await child.exited;
        }

        const entry = watchedFiles[0];

        if (entry === undefined) {
            return;
        }

        const program = createProgram([entry], compilerOptions(loaded.config));

        const emitted = emitProgram(program).files.find((file) => {
            return file.sourceFile === entry;
        });

        if (emitted === undefined) {
            throw new WizError(`No shell output for ${entry}`);
        }

        child = Bun.spawn(
            [loaded.config.compiler.target, emitted.fileName, ...forwarded],
            {
                cwd: process.cwd(),
                env: process.env,
                stdin: "inherit",
                stdout: "inherit",
                stderr: "inherit",
            },
        );
    };

    let running = false;

    let pending = false;

    const rebuild = async (): Promise<void> => {
        if (running) {
            pending = true;

            return;
        }

        running = true;

        do {
            pending = false;

            const code = await buildOrCheck(compilerArguments, true);

            console.error(
                code === 0 ? "Wiz build completed" : "Wiz build failed",
            );

            if (code === 0) {
                await restart();
            }
        } while (pending);

        running = false;
    };

    const watchRoot =
        compilerArguments.length === 0
            ? loaded.config.compiler.rootDir
            : dirname(watchedFiles[0] ?? loaded.config.compiler.rootDir);

    const watcher = watch(
        watchRoot,
        { recursive: true },
        (_event, fileName) => {
            if (fileName !== null && isShellSource(String(fileName))) {
                void rebuild();
            }
        },
    );

    // Start observation before the initial child can print; otherwise a fast caller can edit in the gap.
    await rebuild();

    return new Promise<number>((resolveExit) => {
        const stop = (): void => {
            watcher.close();

            child?.kill("SIGTERM");

            resolveExit(0);
        };

        process.once("SIGINT", stop);

        process.once("SIGTERM", stop);
    });
}

/** Runs the Wiz compiler command group without terminating the host process. */
export async function compilerMain(args: readonly string[]): Promise<number> {
    const command = args[0];

    if (command === undefined || command === "--help" || command === "-h") {
        console.log(COMPILER_HELP);

        return 0;
    }

    if (command === "init") {
        if (args.length !== 1) {
            throw new WizError("Usage: wiz c init");
        }

        return initWiz();
    }

    if (command === "build") {
        rejectUnknownOptions("build", args.slice(1), [
            "--bundle",
            "--minify",
            "--target",
        ]);

        return buildOrCheck(args.slice(1), true);
    }

    if (command === "check") {
        rejectUnknownOptions("check", args.slice(1), ["--target"]);

        return buildOrCheck(args.slice(1), false);
    }

    if (command === "run") {
        return runWiz(args.slice(1));
    }

    if (command === "format") {
        return formatFiles(args.slice(1));
    }

    if (command === "lint") {
        return lintFiles(args.slice(1));
    }

    if (command === "lsp") {
        if (args.length !== 2 || args[1] !== "--stdio") {
            throw new WizError("Usage: wiz c lsp --stdio");
        }

        await serveStdio();

        return 0;
    }

    if (command === "config") {
        if (args.length !== 1) {
            throw new WizError("Usage: wiz c config");
        }

        const loaded = await loadConfig();

        if (reportConfigDiagnostics(loaded)) {
            return 1;
        }

        console.log(JSON.stringify(loaded.config, null, 4));

        return 0;
    }

    if (command === "map") {
        if (args.length !== 2) {
            throw new WizError("Usage: wiz c map <generated.sh:line>");
        }

        return mapPosition(args[1]);
    }

    if (command === "watch") {
        return watchWiz(args.slice(1));
    }

    throw new WizError(`Unknown compiler command: ${command}`);
}
