import type { SourceFile } from "../../ast/source-file.ts";
import type { CompilerOptions } from "../../compiler.ts";
import type { EmitResult } from "../../emission/emit-result.ts";
import { SourceMapBuilder } from "../../source-map/builder.ts";
import { foreignOutputName } from "./output-name.ts";
import { printForeignBody } from "./printer.ts";
import type { ForeignTarget } from "./syntax.ts";

function shebang(target: ForeignTarget): string {
    if (target === "powershell") {
        return "#!/usr/bin/env pwsh\n";
    }

    if (target === "fish") {
        return "#!/usr/bin/env fish\n";
    }

    // Delayed expansion keeps values current inside parenthesized control blocks.
    return "@echo off\r\nsetlocal EnableExtensions EnableDelayedExpansion\r\n";
}

/** Emits a typed, target-neutral Wiz file into a non-Bourne shell. */
export function emitForeignShell(
    file: SourceFile,
    options: CompilerOptions,
    target: ForeignTarget,
): EmitResult {
    const fileName = foreignOutputName(file.fileName, options, target);

    const code = file.declarationFile
        ? ""
        : `${shebang(target)}${printForeignBody(file.statements, target)}`;

    if (options.sourceMap === false) {
        return { sourceFile: file.fileName, fileName, code };
    }

    const builder = new SourceMapBuilder(
        file.syntaxTree.source,
        fileName,
        file.fileName,
    );

    if (file.text.length > 0 && code.length > 0) {
        builder.add(
            { start: 0, end: file.text.length },
            { start: 0, end: code.length },
            code,
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
