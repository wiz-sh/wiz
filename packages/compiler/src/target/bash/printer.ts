import { basename, extname, join, relative, resolve } from "node:path";
import type {
    FunctionDeclaration,
    SourceFile,
    Statement,
    TypedVariableDeclaration,
} from "../../ast/source-file.ts";
import type { CheckedProgram, CompilerOptions } from "../../compiler.ts";
import { bundleMarker } from "../../emission/bundler.ts";
import type { EmitResult } from "../../emission/emit-result.ts";
import { minifyShellSource } from "../../emission/minifier.ts";
import { EmitWriter } from "../../emission/writer.ts";
import { SourceMapBuilder } from "../../source-map/builder.ts";
import type { ShellTargetName } from "../backend.ts";
import type { RuntimeHelper } from "./runtime-library.ts";
import { runtimeHelper } from "./runtime-library.ts";

type BourneTargetName = Extract<ShellTargetName, "bash" | "zsh" | "sh">;

function helperFor(type: string): RuntimeHelper | undefined {
    return ["int", "bool", "path", "file", "directory", "bytes"].includes(type)
        ? (type as RuntimeHelper)
        : undefined;
}

function needsBoundaryCheck(value: string | undefined): boolean {
    return value !== undefined && (value.includes("$") || value.includes("`"));
}

function singleQuoted(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function quotedShellParameter(body: string): string {
    // Building the delimiter separately prevents the host language from treating it as interpolation.
    return ['"$', `{${body}}"`].join("");
}

function projectFileName(fileName: string, options: CompilerOptions): string {
    if (options.rootDir === undefined) {
        return fileName;
    }

    const projectRoot = resolve(options.rootDir, "..");

    const projectRelative = relative(projectRoot, fileName);

    return projectRelative.startsWith("..") ? fileName : projectRelative;
}

function collectHelpers(
    statements: readonly Statement[],
    options: CompilerOptions,
    helpers: Set<RuntimeHelper>,
): void {
    const mode = options.runtimeChecks ?? "boundaries";

    for (const statement of statements) {
        if (
            statement.kind === "CommandStatement" &&
            statement.name === "bytes"
        ) {
            helpers.add("bytes-command");
        }

        if (mode === "none") {
            if (statement.kind === "FunctionDeclaration") {
                collectHelpers(statement.body, options, helpers);
            }

            continue;
        }

        if (statement.kind === "TypedVariableDeclaration") {
            const helper = helperFor(statement.type.name);

            if (
                helper !== undefined &&
                (mode === "all" ||
                    statement.positionalParameter !== undefined ||
                    needsBoundaryCheck(statement.initializer))
            ) {
                helpers.add(helper);
            }
        } else if (statement.kind === "FunctionDeclaration") {
            for (const parameter of statement.parameters) {
                const helper = helperFor(parameter.type.name);

                if (helper !== undefined) {
                    helpers.add(helper);
                }
            }

            collectHelpers(statement.body, options, helpers);
        }
    }
}

function checkLine(
    type: string,
    name: string,
    returnKeyword: "return" | "exit",
    location?: string,
): string {
    const helper = helperFor(type);

    const label = location === undefined ? name : `${name} (${location})`;

    return helper === undefined
        ? ""
        : `__wiz_assert_${helper} ${singleQuoted(label)} "$${name}" || ${returnKeyword} $?\n`;
}

function emitDeclaration(
    file: SourceFile,
    declaration: TypedVariableDeclaration,
    options: CompilerOptions,
    indent: string,
    target: BourneTargetName,
): string {
    const mode = options.runtimeChecks ?? "boundaries";

    const position = file.syntaxTree.source.positionAt(declaration.range.start);

    const location = `${projectFileName(file.fileName, options)}:${position.line + 1}:${position.column + 1}`;

    if (declaration.positionalParameter !== undefined) {
        if (mode === "none") {
            return "";
        }

        const helper = helperFor(declaration.type.name);

        const label = `$${declaration.positionalParameter} (${location})`;

        return helper === undefined
            ? ""
            : `${indent}__wiz_assert_${helper} ${singleQuoted(label)} "$${declaration.positionalParameter}" || return $?`;
    }

    const name = declaration.name ?? "";

    const assignment =
        declaration.initializer === undefined
            ? name
            : `${name}=${declaration.initializer}`;

    const declaredAttributes =
        declaration.attributes === "-" ? "" : declaration.attributes.slice(1);

    const collectionAttribute =
        declaration.type.kind === "array"
            ? "a"
            : declaration.type.kind === "map"
              ? "A"
              : "";

    const combinedAttributes = [...declaredAttributes, collectionAttribute]
        .filter((attribute, index, all) => {
            return attribute !== "" && all.indexOf(attribute) === index;
        })
        .join("");

    const attributes =
        combinedAttributes === "" ? "" : `-${combinedAttributes}`;

    let emitted: string;

    if (declaration.command === "local") {
        emitted = `${indent}local${attributes === "" ? "" : ` ${attributes}`} ${assignment}`;
    } else if (attributes !== "") {
        const declarationCommand = target === "zsh" ? "typeset" : "declare";

        if (target === "sh") {
            const readonly = declaredAttributes.includes("r");

            const exported = declaredAttributes.includes("x");

            emitted = `${indent}${assignment}`;

            if (readonly) {
                emitted += `\n${indent}readonly ${name}`;
            }

            if (exported) {
                emitted += `\n${indent}export ${name}`;
            }
        } else {
            emitted = `${indent}${declarationCommand} ${attributes} ${assignment}`;
        }
    } else {
        emitted = `${indent}${assignment}`;
    }

    if (
        (mode === "all" ||
            (mode === "boundaries" &&
                needsBoundaryCheck(declaration.initializer))) &&
        helperFor(declaration.type.name) !== undefined
    ) {
        emitted += `\n${indent}${checkLine(
            declaration.type.name,
            name,
            declaration.command === "local" ? "return" : "exit",
            location,
        ).trimEnd()}`;
    }

    return emitted;
}

function unquoteDefault(value: string): string {
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1);
    }

    return value;
}

function statementIndent(source: string, offset: number): string {
    const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;

    return source.slice(lineStart, offset).match(/^[ \t]*/)?.[0] ?? "";
}

function emitSourceCommand(
    file: SourceFile,
    statement: Extract<Statement, { kind: "CommandStatement" }>,
    target: BourneTargetName,
    options: CompilerOptions,
): string {
    const argumentNode = statement.arguments[0];

    if (argumentNode === undefined) {
        return statement.text;
    }

    const argument = argumentNode.value;

    const quote = argument[0] === '"' || argument[0] === "'" ? argument[0] : "";

    const path = quote === "" ? argument : argument.slice(1, -1);

    if (
        !path.endsWith(".wiz") &&
        !path.endsWith(".sh") &&
        !path.endsWith(".zsh")
    ) {
        return statement.text;
    }

    if (options.bundle === true) {
        return bundleMarker(file.fileName, path);
    }

    if (!path.endsWith(".wiz")) {
        return statement.text;
    }

    const extension = target === "zsh" ? ".zsh" : ".sh";

    const generated = `${path.slice(0, -4)}${extension}`;

    // Relative sources must resolve beside the emitted script, not the caller's current directory.
    const currentSource =
        target === "bash"
            ? quotedShellParameter("BASH_SOURCE[0]")
            : target === "zsh"
              ? quotedShellParameter("(%):-%N")
              : '"$0"';

    const replacement = generated.startsWith("/")
        ? `"${generated}"`
        : `"$(cd -- "$(dirname -- ${currentSource})" && pwd)/${generated.replace(/^\.\//, "")}"`;

    let result =
        statement.text.slice(
            0,
            argumentNode.range.start - statement.range.start,
        ) +
        replacement +
        statement.text.slice(argumentNode.range.end - statement.range.start);

    if (target === "sh" && statement.name === "source") {
        result = result.replace(/^([ \t]*)source\b/, "$1.");
    }

    return result;
}

function emittedModulePath(
    specifier: string,
    target: BourneTargetName,
): string {
    const extension = target === "zsh" ? ".zsh" : ".sh";

    const generated = `${specifier.slice(0, -4)}${extension}`;

    const currentSource =
        target === "bash"
            ? quotedShellParameter("BASH_SOURCE[0]")
            : target === "zsh"
              ? quotedShellParameter("(%):-%N")
              : '"$0"';

    return generated.startsWith("/")
        ? `"${generated}"`
        : `"$(cd -- "$(dirname -- ${currentSource})" && pwd)/${generated.replace(/^\.\//, "")}"`;
}

function emitScopedSource(
    file: SourceFile,
    statement: Extract<Statement, { kind: "SourceImportDeclaration" }>,
    options: CompilerOptions,
    target: BourneTargetName,
    program: CheckedProgram | undefined,
): string {
    if (target !== "bash") {
        return statement.text;
    }

    const moduleImport = program?.moduleImports
        .get(file.fileName)
        ?.find((candidate) => {
            return candidate.range.start === statement.range.start;
        });

    const binding =
        moduleImport === undefined
            ? undefined
            : program?.bindings.get(moduleImport.dependencyFile);

    const state = `__wiz_import_state_${statement.range.start}`;

    const status = `__wiz_import_status_${statement.range.start}`;

    const indent = statementIndent(file.text, statement.range.start);

    const source =
        options.bundle === true
            ? `{\n${bundleMarker(file.fileName, statement.specifier)}} 1>&3`
            : `source ${emittedModulePath(statement.specifier, target)} 1>&3`;

    const captures = statement.imports.map((name) => {
        const symbol = binding?.exports.get(name);

        return symbol?.declaration.kind === "FunctionDeclaration"
            ? `declare -f ${name}`
            : `declare -p ${name}`;
    });

    const body = [
        "{",
        `    ${state}="$(`,
        `        ${source}`,
        `        ${status}=$?`,
        `        if (( ${status} != 0 )); then`,
        `            exit "${"$"}${status}"`,
        "        fi",
        ...captures.map((capture) => {
            return `        ${capture}`;
        }),
        '    )"',
        "} 3>&1",
        `${status}=$?`,
        `if (( ${status} != 0 )); then`,
        `    return "${"$"}${status}" 2>/dev/null || exit "${"$"}${status}"`,
        "fi",
        `eval "${"$"}${state}"`,
        `unset ${state} ${status}`,
    ];

    return `${body
        .map((line, index) => {
            return index === 0 ? line : `${indent}${line}`;
        })
        .join("\n")}\n`;
}

function emitRange(
    file: SourceFile,
    statements: readonly Statement[],
    start: number,
    end: number,
    options: CompilerOptions,
    target: BourneTargetName,
    program?: CheckedProgram,
): string {
    let result = "";

    let cursor = start;

    for (const statement of statements) {
        result += file.text.slice(cursor, statement.range.start);

        const indent = statementIndent(file.text, statement.range.start);

        if (statement.kind === "TypedVariableDeclaration") {
            result += emitDeclaration(file, statement, options, indent, target);
        } else if (statement.kind === "FunctionDeclaration") {
            result += statement.typed
                ? emitFunction(
                      file,
                      statement,
                      options,
                      indent,
                      target,
                      program,
                  )
                : emitLegacyFunction(file, statement, options, target, program);
        } else if (statement.kind === "TypeImportDeclaration") {
            // Type packages shape analysis only and must never affect shell execution.
            result += "";
        } else if (statement.kind === "SourceImportDeclaration") {
            result += emitScopedSource(
                file,
                statement,
                options,
                target,
                program,
            );
        } else if (
            statement.kind === "CommandStatement" &&
            (statement.name === "source" || statement.name === ".")
        ) {
            result += emitSourceCommand(file, statement, target, options);
        } else if (
            statement.kind === "CommandStatement" &&
            statement.name === "bytes"
        ) {
            result += statement.text.replace(/\bbytes\b/, "__wiz_bytes");
        } else {
            result += statement.text;
        }

        cursor = statement.range.end;
    }

    result += file.text.slice(cursor, end);

    return result;
}

function emitLegacyFunction(
    file: SourceFile,
    declaration: FunctionDeclaration,
    options: CompilerOptions,
    target: BourneTargetName,
    program?: CheckedProgram,
): string {
    const header = file.text.slice(
        declaration.range.start,
        declaration.bodyRange.start,
    );

    const body = emitRange(
        file,
        declaration.body,
        declaration.bodyRange.start,
        declaration.bodyRange.end,
        options,
        target,
        program,
    );

    const footer = file.text.slice(
        declaration.bodyRange.end,
        declaration.range.end,
    );

    return `${header}${body}${footer}`;
}

function emitFunction(
    file: SourceFile,
    declaration: FunctionDeclaration,
    options: CompilerOptions,
    indent: string,
    target: BourneTargetName,
    program?: CheckedProgram,
): string {
    let result = `${declaration.name}() {\n`;

    for (let index = 0; index < declaration.parameters.length; index += 1) {
        const parameter = declaration.parameters[index];

        if (parameter === undefined) {
            continue;
        }

        const position = index + 1;

        if (parameter.rest) {
            if (target === "sh") {
                result += `${indent}    local ${parameter.name}="$${position}"\n`;
            } else {
                result += `${indent}    local ${parameter.name}=("${"$"}{@:${position}}")\n`;
            }

            continue;
        }

        const value =
            parameter.defaultValue === undefined
                ? `"$${position}"`
                : `"\${${position}:-${unquoteDefault(parameter.defaultValue)}}"`;

        result += `${indent}    local ${parameter.name}=${value}\n`;

        if ((options.runtimeChecks ?? "boundaries") !== "none") {
            const parameterPosition = file.syntaxTree.source.positionAt(
                parameter.range.start,
            );

            const location = `${projectFileName(file.fileName, options)}:${parameterPosition.line + 1}:${parameterPosition.column + 1}`;

            const check = checkLine(
                parameter.type.name,
                parameter.name,
                "return",
                location,
            );

            if (check !== "") {
                result += `${indent}    ${check}`;
            }
        }
    }

    let body = emitRange(
        file,
        declaration.body,
        declaration.bodyRange.start,
        declaration.bodyRange.end,
        options,
        target,
        program,
    );

    body = body.replace(/^\r?\n/, "");

    if (body.length > 0) {
        result += body;

        if (!body.endsWith("\n")) {
            result += "\n";
        }
    }

    result += `${indent}}`;

    return result;
}

function generatedName(
    file: SourceFile,
    options: CompilerOptions,
    target: BourneTargetName,
): string {
    const root = resolve(options.rootDir ?? ".");

    const out = resolve(options.outDir ?? "dist");

    const sourceRelative = relative(root, file.fileName);

    const safeRelative = sourceRelative.startsWith("..")
        ? basename(file.fileName)
        : sourceRelative;

    const extension = extname(safeRelative);

    const outputExtension = target === "zsh" ? ".zsh" : ".sh";

    return join(
        out,
        `${safeRelative.slice(0, -extension.length)}${outputExtension}`,
    );
}

/** Prints one checked source for a Bourne-family target and records mappings. */
export function printShell(
    file: SourceFile,
    options: CompilerOptions,
    target: BourneTargetName,
    program?: CheckedProgram,
): EmitResult {
    const fileName = generatedName(file, options, target);

    const sourceMapSource = projectFileName(file.fileName, options);

    const sourceMapGenerated = projectFileName(fileName, options);

    if (file.declarationFile) {
        return {
            sourceFile: file.fileName,
            fileName,
            code: "",
            ...(options.sourceMap === false
                ? {}
                : {
                      map: {
                          version: 1,
                          compilerVersion: "0.1.0",
                          sourceFile: sourceMapSource,
                          generatedFile: sourceMapGenerated,
                          mappings: [],
                      },
                      mapText: `${JSON.stringify(
                          {
                              version: 1,
                              compilerVersion: "0.1.0",
                              sourceFile: sourceMapSource,
                              generatedFile: sourceMapGenerated,
                              mappings: [],
                          },
                          null,
                          4,
                      )}\n`,
                  }),
        };
    }

    const helpers = new Set<RuntimeHelper>();

    collectHelpers(file.statements, options, helpers);

    const writer = new EmitWriter();

    const shebang = file.text.startsWith("#!") ? lineEndOffset(file.text) : 0;

    const generatedShebang =
        target === "sh" ? "#!/bin/sh\n" : `#!/usr/bin/env ${target}\n`;

    writer.write(generatedShebang);

    if (helpers.size > 0) {
        for (const helper of helpers) {
            writer.write(runtimeHelper(helper, target));
        }

        writer.write("\n");
    }

    const relevant =
        shebang === 0
            ? file.statements
            : file.statements.filter((statement) => {
                  return statement.range.start >= shebang;
              });

    writer.write(
        emitRange(
            file,
            relevant,
            shebang,
            file.text.length,
            options,
            target,
            program,
        ),
    );

    const unminified = writer.toString();

    const code =
        options.minify && options.bundle !== true
            ? minifyShellSource(unminified, fileName)
            : unminified;

    if (options.sourceMap === false) {
        return { sourceFile: file.fileName, fileName, code };
    }

    const builder = new SourceMapBuilder(
        file.syntaxTree.source,
        sourceMapGenerated,
        sourceMapSource,
    );

    let generatedCursor = generatedShebang.length;

    for (const statement of relevant) {
        const snippet =
            statement.kind === "FunctionDeclaration"
                ? statement.name
                : statement.text.trim();

        const generatedStart =
            snippet.length === 0
                ? generatedCursor
                : code.indexOf(snippet.split(/\s/)[0] ?? "", generatedCursor);

        const safeGeneratedStart =
            generatedStart < 0 ? generatedCursor : generatedStart;

        builder.add(
            statement.range,
            {
                start: Math.max(0, safeGeneratedStart),
                end:
                    Math.max(0, safeGeneratedStart) +
                    Math.max(1, snippet.length),
            },
            code,
            statement.kind === "FunctionDeclaration"
                ? statement.name
                : undefined,
        );

        generatedCursor = Math.max(
            generatedCursor,
            safeGeneratedStart + Math.max(1, snippet.length),
        );
    }

    const map = builder.build();

    return {
        sourceFile: file.fileName,
        fileName,
        code,
        map,
        mapText: `${JSON.stringify(map, null, 4)}\n`,
    };
}

export function printBash(
    file: SourceFile,
    options: CompilerOptions,
    program?: CheckedProgram,
): EmitResult {
    return printShell(file, options, "bash", program);
}

function lineEndOffset(text: string): number {
    const end = text.indexOf("\n");

    return end < 0 ? text.length : end + 1;
}
