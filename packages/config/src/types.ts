export type DiagnosticSeverity = "error" | "warning";
export type RuntimeChecks = "none" | "boundaries" | "all";
export type UnknownCommandBehavior = "allow" | "warning" | "error";
export type LintSeverity = "off" | "warning" | "error";

export interface ConfigDiagnostic {
    code: string;
    message: string;
    severity: DiagnosticSeverity;
    path?: string;
}

export interface CompilerConfig {
    target: "bash" | "zsh" | "sh" | "fish" | "powershell" | "cmd";
    rootDir: string;
    outDir: string;
    sourceMap: boolean;
    declaration: boolean;
    noEmitOnError: boolean;
    runtimeChecks: RuntimeChecks;
    bundle: boolean;
    minify: boolean;
}

export interface TypeCheckingConfig {
    strict: boolean;
    allowAny: boolean;
    implicitAny: boolean;
    unknownCommands: UnknownCommandBehavior;
    checkSourcedFiles: boolean;
    checkDeclarationFiles: boolean;
    types: readonly string[];
}

export interface FormatterConfig {
    indentStyle: "space" | "tab";
    indentWidth: number;
    lineWidth: number;
    quoteStyle: "preserve";
    trailingNewline: boolean;
}

export interface LinterConfig {
    enabled: boolean;
    recommended: boolean;
    rules: Readonly<Record<string, LintSeverity>>;
}

export interface FilesConfig {
    include: readonly string[];
    exclude: readonly string[];
}

export interface WizConfig {
    projectRoot: string;
    configPath?: string;
    compiler: CompilerConfig;
    typeChecking: TypeCheckingConfig;
    formatter: FormatterConfig;
    linter: LinterConfig;
    files: FilesConfig;
}

export interface LoadConfigResult {
    config: WizConfig;
    diagnostics: readonly ConfigDiagnostic[];
}
