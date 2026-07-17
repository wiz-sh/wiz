import type { LanguageFeature } from "../target.ts";

const supported = new Set<LanguageFeature>([
    "arrays",
    "associative-arrays",
    "process-substitution",
    "double-brackets",
    "arithmetic-command",
    "nameref",
    "scoped-import",
]);

export function supportsBashFeature(feature: LanguageFeature): boolean {
    return supported.has(feature);
}
