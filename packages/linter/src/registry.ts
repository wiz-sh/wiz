import type { LintRule, RuleDefinition } from "./rule.ts";

// The callable interface keeps registration lifecycle APIs readable in signatures.
export interface RuleRegistrationDisposer {
    // biome-ignore lint/style/useShorthandFunctionType: spacious callable contract
    (): void;
}

function rule(
    name: string,
    category: RuleDefinition["category"],
    defaultSeverity: RuleDefinition["defaultSeverity"],
    description: string,
    fixable: RuleDefinition["fixable"] = "none",
): RuleDefinition {
    return {
        name: `${category}/${name}`,
        category,
        defaultSeverity,
        description,
        fixable,
    };
}

const builtInRules: readonly RuleDefinition[] = [
    rule(
        "no-undefined-variable",
        "correctness",
        "error",
        "Reports references to variables that are not declared.",
    ),
    rule(
        "no-invalid-positional-parameter",
        "correctness",
        "error",
        "Reports positional parameters outside the declared signature.",
    ),
    rule(
        "no-impossible-type-check",
        "correctness",
        "error",
        "Reports type tests that cannot succeed.",
    ),
    rule(
        "no-invalid-return-status",
        "correctness",
        "error",
        "Requires return status values from 0 through 255.",
    ),
    rule(
        "no-unquoted-expansion",
        "safety",
        "warning",
        "Quotes scalar parameter expansions to prevent word splitting.",
        "safe",
    ),
    rule(
        "no-unquoted-array-expansion",
        "safety",
        "error",
        "Requires quoted array expansions.",
    ),
    rule(
        "no-eval",
        "safety",
        "warning",
        "Avoids eval because input can become executable shell source.",
    ),
    rule(
        "no-dynamic-source",
        "safety",
        "warning",
        "Requires statically resolvable source paths.",
    ),
    rule(
        "no-unsafe-rm",
        "safety",
        "warning",
        "Reports recursive removal of root-like paths.",
    ),
    rule(
        "no-word-splitting-assumption",
        "safety",
        "warning",
        "Reports unquoted values that depend on implicit word splitting.",
    ),
    rule(
        "no-ignored-status",
        "suspicious",
        "warning",
        "Reports ignored status results where failure is likely meaningful.",
    ),
    rule(
        "no-useless-command-substitution",
        "suspicious",
        "warning",
        "Reports command substitution whose output is discarded.",
    ),
    rule(
        "no-shadowed-parameter",
        "suspicious",
        "warning",
        "Reports locals that shadow typed parameters.",
    ),
    rule(
        "no-empty-condition",
        "suspicious",
        "warning",
        "Reports empty test expressions.",
    ),
    rule(
        "no-implicit-any",
        "suspicious",
        "warning",
        "Reports values inferred with the permissive any type.",
    ),
    rule(
        "prefer-typed-parameters",
        "style",
        "off",
        "Prefers typed signatures over positional parameter assertions.",
    ),
    rule(
        "prefer-local",
        "style",
        "warning",
        "Prefers function-local variables.",
        "unsafe",
    ),
    rule(
        "prefer-double-brackets",
        "style",
        "warning",
        "Prefers Bash double-bracket conditions.",
        "unsafe",
    ),
    rule(
        "no-redundant-declare",
        "style",
        "warning",
        "Reports declare with no attributes or type.",
    ),
];

const customRules = new Map<string, LintRule>();

export const rules: readonly RuleDefinition[] = builtInRules;

export function getRule(name: string): RuleDefinition | undefined {
    return (
        customRules.get(name)?.definition ??
        builtInRules.find((rule) => {
            return rule.name === name;
        })
    );
}

/** Registers one process-local rule for embedders and plugin packages. */
export function registerRule(rule: LintRule): RuleRegistrationDisposer {
    if (getRule(rule.definition.name) !== undefined) {
        throw new Error(
            `Lint rule is already registered: ${rule.definition.name}`,
        );
    }

    customRules.set(rule.definition.name, rule);

    return () => {
        customRules.delete(rule.definition.name);
    };
}

export function registeredCustomRules(): readonly LintRule[] {
    return [...customRules.values()];
}
