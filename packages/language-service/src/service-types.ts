import type { TextRange } from "@wiz/compiler";
import type { FormatOptions } from "@wiz/formatter";
import type { LintDiagnostic, LinterOptions } from "@wiz/linter";

export interface TextEdit {
    range: TextRange;
    newText: string;
}

export interface WorkspaceTextEdit extends TextEdit {
    uri: string;
}

export interface ServiceLocation {
    uri: string;
    range: TextRange;
}

export interface HoverInfo {
    contents: string;
    range: TextRange;
}

export interface CompletionItem {
    label: string;
    detail: string;
    kind: "function" | "variable" | "keyword" | "type";
    documentation?: string;
}

export interface WorkspaceSymbolInfo extends DocumentSymbolInfo {
    uri: string;
}

export interface InlayHintInfo {
    position: number;
    label: string;
}

export interface FoldingRangeInfo {
    range: TextRange;
}

export interface SignatureInfo {
    label: string;
    parameters: readonly string[];
    activeParameter: number;
    documentation?: string;
}

export interface DocumentSymbolInfo {
    name: string;
    kind: "function" | "variable" | "environment";
    range: TextRange;
}

export interface CodeActionInfo {
    title: string;
    kind: "quickfix";
    diagnostic: LintDiagnostic;
    edit?: TextEdit;
}

export interface ServiceDiagnostic {
    code: string;
    message: string;
    severity: "error" | "warning";
    range: TextRange;
}

export interface LanguageServiceConfiguration {
    formatter?: FormatOptions;
    linter?: LinterOptions;
    diagnostics?: readonly ServiceDiagnostic[];
}
