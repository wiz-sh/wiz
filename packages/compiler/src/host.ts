import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { SourceFile } from "./ast/source-file.ts";

export interface CompilerHost {
    readFile(path: string): string | undefined;
    fileExists(path: string): boolean;
    resolvePath(specifier: string, containingFile: string): string;
    parseSourceFile?(path: string, text: string): SourceFile;
}

/** Creates the standard filesystem-backed compiler host. */
export function createCompilerHost(): CompilerHost {
    return {
        readFile(path) {
            try {
                return readFileSync(path, "utf8");
            } catch {
                return undefined;
            }
        },
        fileExists(path) {
            try {
                return statSync(path).isFile();
            } catch {
                return false;
            }
        },
        resolvePath(specifier, containingFile) {
            return resolve(dirname(containingFile), specifier);
        },
    };
}
