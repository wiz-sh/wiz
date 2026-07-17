export type { LintBaselineEntry, LinterOptions } from "./config.ts";
export { applyLintFixes, lintSourceFile, rules } from "./linter.ts";
export { getRule, registerRule } from "./registry.ts";
export type { SarifLog } from "./reporters.ts";
export { diagnosticsToSarif } from "./reporters.ts";
export type {
    LintDiagnostic,
    LintFix,
    LintRule,
    RuleCategory,
    RuleContext,
    RuleDefinition,
    RuleSeverity,
} from "./rule.ts";
