import type { SourceFile } from "../ast/source-file.ts";
import { DiagnosticCodes } from "../diagnostics/codes.ts";
import type { Diagnostic } from "../diagnostics/diagnostic.ts";
import type { ShellTargetName } from "./backend.ts";
import type { LanguageFeature } from "./target.ts";

interface FeaturePattern {
    feature: LanguageFeature;
    pattern: RegExp;
}

const patterns: readonly FeaturePattern[] = [
    {
        feature: "associative-arrays",
        pattern: /\bdeclare\s+-[A-Za-z]*A[A-Za-z]*(?=\s)|\bmap\s*</,
    },
    {
        feature: "arrays",
        pattern: /\bdeclare\s+-[A-Za-z]*a[A-Za-z]*(?=\s)|\[\]|=\s*\(/,
    },
    { feature: "process-substitution", pattern: /(?:<|>)\(/ },
    { feature: "double-brackets", pattern: /\[\[|\]\]/ },
    { feature: "arithmetic-command", pattern: /(?<!\$)\(\(/ },
    {
        feature: "nameref",
        pattern: /\bdeclare\s+-[A-Za-z]*n[A-Za-z]*(?=\s)/,
    },
    { feature: "scoped-import", pattern: /\bsource\s+(?:-I|--import)\b/ },
];

function supported(feature: LanguageFeature, target: ShellTargetName): boolean {
    if (feature === "scoped-import") {
        return target === "bash";
    }

    if (target === "bash" || target === "zsh") {
        return true;
    }

    return false;
}

/** Rejects dialect-specific constructs instead of emitting subtly invalid shell. */
export function validateTargetFeatures(
    file: SourceFile,
    target: ShellTargetName,
): readonly Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const candidate of patterns) {
        if (supported(candidate.feature, target)) {
            continue;
        }

        const match = candidate.pattern.exec(file.text);

        if (match === null) {
            continue;
        }

        diagnostics.push({
            code: DiagnosticCodes.unsupportedTargetFeature,
            message: `${candidate.feature} is not supported by the ${target} target`,
            severity: "error",
            phase: "emit",
            fileName: file.fileName,
            range: {
                start: match.index,
                end: match.index + match[0].length,
            },
        });
    }

    return diagnostics;
}
