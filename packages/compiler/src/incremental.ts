import { resolve } from "node:path";
import type { SourceFile } from "./ast/source-file.ts";
import {
    type CompilerOptions,
    createProgram,
    type Program,
} from "./compiler.ts";
import { type CompilerHost, createCompilerHost } from "./host.ts";
import { parseSourceFile } from "./parser/parser.ts";

interface CachedSource {
    text: string;
    file: SourceFile;
}

/**
 * Maintains source overlays and parsed files across builds.
 *
 * Binding and checking still produce immutable snapshots, while unchanged files
 * retain their lossless tree and semantic AST identities for editor consumers.
 */
export class IncrementalCompiler {
    readonly #baseHost: CompilerHost;

    readonly #overlays = new Map<string, string>();

    readonly #cache = new Map<string, CachedSource>();

    constructor(baseHost: CompilerHost = createCompilerHost()) {
        this.#baseHost = baseHost;
    }

    updateFile(path: string, text: string): void {
        const absolute = resolve(path);

        this.#overlays.set(absolute, text);

        const cached = this.#cache.get(absolute);

        if (cached?.text !== text) {
            this.#cache.delete(absolute);
        }
    }

    removeFile(path: string): void {
        const absolute = resolve(path);

        this.#overlays.delete(absolute);

        this.#cache.delete(absolute);
    }

    clear(): void {
        this.#overlays.clear();

        this.#cache.clear();
    }

    createProgram(
        rootNames: readonly string[],
        options: CompilerOptions = {},
    ): Program {
        return createProgram(rootNames, options, this.host());
    }

    private host(): CompilerHost {
        return {
            readFile: (path) => {
                const absolute = resolve(path);

                return (
                    this.#overlays.get(absolute) ??
                    this.#baseHost.readFile(absolute)
                );
            },
            fileExists: (path) => {
                const absolute = resolve(path);

                return (
                    this.#overlays.has(absolute) ||
                    this.#baseHost.fileExists(absolute)
                );
            },
            resolvePath: (specifier, containingFile) => {
                return this.#baseHost.resolvePath(specifier, containingFile);
            },
            parseSourceFile: (path, text) => {
                const absolute = resolve(path);

                const cached = this.#cache.get(absolute);

                if (cached?.text === text) {
                    return cached.file;
                }

                const file = parseSourceFile(text, absolute);

                this.#cache.set(absolute, { text, file });

                return file;
            },
        };
    }
}
