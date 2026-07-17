import type { LanguageFeature } from "../target.ts";

export function supportsCmdFeature(_feature: LanguageFeature): boolean {
    return false;
}
