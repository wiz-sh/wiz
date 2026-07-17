export type { AstNode } from "./ast/ast-node.ts";
export type {
    DocumentationTag,
    WizDocumentation,
} from "./ast/documentation.ts";
export { getDocumentation } from "./ast/documentation.ts";
export type * from "./ast/source-file.ts";
export type { BindingOptions, BindingResult } from "./binding/binder.ts";
export { bindSourceFile } from "./binding/binder.ts";
export { Scope } from "./binding/scope.ts";
export type { WizSymbol } from "./binding/symbol.ts";
export type { CheckResult } from "./checker.ts";
export { checkSourceFile } from "./checker.ts";
export type { CheckedProgram, CompilerOptions, Program } from "./compiler.ts";
export {
    checkProgram,
    compileSource,
    createProgram,
    emitProgram,
    getDiagnostics,
} from "./compiler.ts";
export type { Diagnostic } from "./diagnostics/diagnostic.ts";
export type { EmitResult, ProgramEmitResult } from "./emission/emit-result.ts";
export { minifyShellSource } from "./emission/minifier.ts";
export type { CompilerHost } from "./host.ts";
export { createCompilerHost } from "./host.ts";
export { IncrementalCompiler } from "./incremental.ts";
export { lexSource } from "./lexer/lexer.ts";
export { parseSourceFile, parseSyntaxTree } from "./parser/parser.ts";
export {
    loadSourceMap,
    mapGeneratedToSource,
    mapSourceToGenerated,
} from "./source-map/consumer.ts";
export type * from "./source-map/types.ts";
export type {
    StandardLibraryFile,
    StandardLibraryName,
} from "./standard-library.ts";
export {
    createStandardLibraryScope,
    defaultStandardLibraries,
    getStandardLibraryFiles,
    standardLibrariesForTarget,
} from "./standard-library.ts";
export { SourceText } from "./syntax/source-text.ts";
export { SyntaxKind } from "./syntax/syntax-kind.ts";
export type { SyntaxTree } from "./syntax/syntax-tree.ts";
export type { TextPosition, TextRange } from "./syntax/text-range.ts";
export type { SyntaxToken } from "./syntax/token.ts";
export type {
    ShellTargetBackend,
    ShellTargetName,
} from "./target/backend.ts";
export { isAssignable } from "./types/assignability.ts";
export { parseType, requiredType } from "./types/factory.ts";
export type { WizType } from "./types/type.ts";
