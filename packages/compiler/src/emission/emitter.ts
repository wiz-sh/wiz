import type { CheckedProgram } from "../compiler.ts";
import type { ShellTargetBackend } from "../target/backend.ts";
import { bashBackend } from "../target/bash/lower.ts";
import { cmdBackend } from "../target/cmd/backend.ts";
import { fishBackend } from "../target/fish/backend.ts";
import { powerShellBackend } from "../target/powershell/backend.ts";
import { shBackend } from "../target/sh/backend.ts";
import { zshBackend } from "../target/zsh/backend.ts";
import { bundleEmittedFiles } from "./bundler.ts";
import type { ProgramEmitResult } from "./emit-result.ts";

export function emitCheckedProgram(program: CheckedProgram): ProgramEmitResult {
    const hasErrors = program.diagnostics.some((diagnostic) => {
        return diagnostic.severity === "error";
    });

    if (hasErrors && program.options.noEmitOnError !== false) {
        return {
            files: [],
            diagnostics: program.diagnostics,
            emitSkipped: true,
        };
    }

    const backends: Readonly<Record<string, ShellTargetBackend>> = {
        bash: bashBackend,
        zsh: zshBackend,
        sh: shBackend,
        fish: fishBackend,
        powershell: powerShellBackend,
        cmd: cmdBackend,
    };

    const backend = backends[program.options.target ?? "bash"] ?? bashBackend;

    const lowered = backend.lower(program, program.options);

    const emitted = backend.emit(lowered, program.options);

    const files =
        program.options.bundle === true
            ? bundleEmittedFiles(program, emitted, program.options)
            : emitted;

    return {
        files,
        diagnostics: program.diagnostics,
        emitSkipped: false,
    };
}
