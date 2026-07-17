import type { BindingResult, SourceFile, TextRange } from "@wiz/compiler";

export type RuleCategory = "correctness" | "safety" | "suspicious" | "style";
export type RuleSeverity = "off" | "warning" | "error";

export interface LintFix {
    range: TextRange;
    text: string;
    safe: boolean;
}

export interface LintDiagnostic {
    rule: string;
    category: RuleCategory;
    severity: Exclude<RuleSeverity, "off">;
    message: string;
    fileName: string;
    range: TextRange;
    fix?: LintFix;
}

export interface RuleDefinition {
    name: string;
    category: RuleCategory;
    defaultSeverity: RuleSeverity;
    description: string;
    fixable: "none" | "safe" | "unsafe";
}

export interface RuleContext {
    file: SourceFile;
    binding: BindingResult;
    report(message: string, range: TextRange, fix?: LintFix): void;
}

export interface LintRule {
    definition: RuleDefinition;
    run(context: RuleContext): void;
}
