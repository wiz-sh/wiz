import type { LanguageFeature } from "../target.ts";

const supported = new Set<LanguageFeature>([
    "arrays",
    "associative-arrays",
    "process-substitution",
    "double-brackets",
    "arithmetic-command",
    "nameref",
]);

export function supportsZshFeature(feature: LanguageFeature): boolean {
    return supported.has(feature);
}
