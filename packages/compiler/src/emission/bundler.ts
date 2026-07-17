import { dirname, resolve } from "node:path";
import type { CheckedProgram, CompilerOptions } from "../compiler.ts";
import type { EmitResult } from "./emit-result.ts";
import { minifyShellSource } from "./minifier.ts";

const markerPrefix = "# __wiz_bundle_source__:";
const markerPattern = /^# __wiz_bundle_source__:(.+)$/gm;

/** Creates an inert placeholder that the project emitter replaces after lowering. */
export function bundleMarker(
    containingFile: string,
    specifier: string,
): string {
    const dependency = resolve(dirname(containingFile), specifier);

    return `${markerPrefix}${encodeURIComponent(dependency)}\n`;
}

function dependencies(code: string): string[] {
    const result: string[] = [];

    for (const match of code.matchAll(markerPattern)) {
        const encoded = match[1];

        if (encoded !== undefined) {
            result.push(decodeURIComponent(encoded));
        }
    }

    return result;
}

function withoutShebang(code: string): string {
    if (!code.startsWith("#!")) {
        return code;
    }

    const newline = code.indexOf("\n");

    return newline < 0 ? "" : code.slice(newline + 1);
}

/** Inlines lowered static source dependencies into independently runnable entry files. */
export function bundleEmittedFiles(
    program: CheckedProgram,
    files: readonly EmitResult[],
    options: CompilerOptions,
): readonly EmitResult[] {
    const bySource = new Map(
        files.map((file) => {
            return [resolve(file.sourceFile), file] as const;
        }),
    );

    const referenced = new Set<string>();

    for (const file of files) {
        for (const dependency of dependencies(file.code)) {
            referenced.add(dependency);
        }
    }

    const entries = files.filter((file) => {
        return (
            program.rootNames.includes(resolve(file.sourceFile)) &&
            !referenced.has(resolve(file.sourceFile))
        );
    });

    function inline(file: EmitResult, stack: ReadonlySet<string>): string {
        const source = resolve(file.sourceFile);

        if (stack.has(source)) {
            throw new Error(`Circular bundled source dependency: ${source}`);
        }

        const nextStack = new Set(stack);

        nextStack.add(source);

        return file.code.replace(markerPattern, (_marker, encoded: string) => {
            const dependencyPath = decodeURIComponent(encoded);

            const dependency = bySource.get(dependencyPath);

            if (dependency === undefined) {
                throw new Error(
                    `Bundled source was not emitted: ${dependencyPath}`,
                );
            }

            return withoutShebang(inline(dependency, nextStack)).trimEnd();
        });
    }

    return entries.map((entry) => {
        const code = inline(entry, new Set());

        return {
            ...entry,
            code: options.minify
                ? minifyShellSource(code, entry.fileName)
                : code,
        };
    });
}
