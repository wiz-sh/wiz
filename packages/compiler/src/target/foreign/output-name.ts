import { basename, extname, join, relative, resolve } from "node:path";
import type { CompilerOptions } from "../../compiler.ts";
import type { ForeignTarget } from "./syntax.ts";

/** Selects a native extension without allowing sources outside rootDir to escape outDir. */
export function foreignOutputName(
    fileName: string,
    options: CompilerOptions,
    target: ForeignTarget,
): string {
    const root = resolve(options.rootDir ?? ".");

    const out = resolve(options.outDir ?? "dist");

    const sourceRelative = relative(root, fileName);

    const safeRelative = sourceRelative.startsWith("..")
        ? basename(fileName)
        : sourceRelative;

    const extension = extname(safeRelative);

    const outputExtension =
        target === "powershell" ? ".ps1" : target === "cmd" ? ".cmd" : ".fish";

    return join(
        out,
        `${safeRelative.slice(0, -extension.length)}${outputExtension}`,
    );
}
