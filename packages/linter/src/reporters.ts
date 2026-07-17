import type { LintDiagnostic, RuleDefinition } from "./rule.ts";

export interface SarifLog {
    version: "2.1.0";
    $schema: string;
    runs: readonly object[];
}

/** Converts Wiz lint results into SARIF for GitHub and security tooling. */
export function diagnosticsToSarif(
    diagnostics: readonly LintDiagnostic[],
    definitions: readonly RuleDefinition[],
): SarifLog {
    const usedRules = new Set(
        diagnostics.map((diagnostic) => {
            return diagnostic.rule;
        }),
    );

    return {
        version: "2.1.0",
        $schema: "https://json.schemastore.org/sarif-2.1.0.json",
        runs: [
            {
                tool: {
                    driver: {
                        name: "Wiz Linter",
                        informationUri: "https://wiz.sh/docs/tooling/linter",
                        rules: definitions
                            .filter((definition) => {
                                return usedRules.has(definition.name);
                            })
                            .map((definition) => {
                                return {
                                    id: definition.name,
                                    shortDescription: {
                                        text: definition.description,
                                    },
                                };
                            }),
                    },
                },
                results: diagnostics.map((diagnostic) => {
                    return {
                        ruleId: diagnostic.rule,
                        level:
                            diagnostic.severity === "error"
                                ? "error"
                                : "warning",
                        message: { text: diagnostic.message },
                        locations: [
                            {
                                physicalLocation: {
                                    artifactLocation: {
                                        uri: diagnostic.fileName,
                                    },
                                    region: {
                                        charOffset: diagnostic.range.start,
                                        charLength:
                                            diagnostic.range.end -
                                            diagnostic.range.start,
                                    },
                                },
                            },
                        ],
                    };
                }),
            },
        ],
    };
}
