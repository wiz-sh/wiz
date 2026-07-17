import type { RuleSeverity } from "./rule.ts";

export interface LintBaselineEntry {
    fileName: string;
    rule: string;
    start?: number;
}

export interface LinterOptions {
    recommended?: boolean;
    rules?: Readonly<Record<string, RuleSeverity>>;
    baseline?: readonly LintBaselineEntry[];
}
