import type { Diagnostic } from "../diagnostics/diagnostic.ts";
import type { SyntaxTree } from "../syntax/syntax-tree.ts";
import type { TextRange } from "../syntax/text-range.ts";
import type { WizType } from "../types/type.ts";
import type { AstNode } from "./ast-node.ts";

export interface FunctionParameter extends AstNode {
    kind: "FunctionParameter";
    name: string;
    type: WizType;
    optional: boolean;
    rest?: boolean;
    defaultValue?: string;
}

export interface TypedVariableDeclaration extends AstNode {
    kind: "TypedVariableDeclaration";
    command: "declare" | "local";
    attributes: string;
    type: WizType;
    name?: string;
    positionalParameter?: number;
    initializer?: string;
}

export interface FunctionDeclaration extends AstNode {
    kind: "FunctionDeclaration";
    name: string;
    parameters: readonly FunctionParameter[];
    resultType: WizType;
    bodyRange: TextRange;
    bodyText: string;
    body: readonly Statement[];
    typed: boolean;
}

export interface CommandArgument extends AstNode {
    kind: "CommandArgument";
    value: string;
}

export type ShellWordPartKind =
    | "literal"
    | "parameter-expansion"
    | "command-substitution"
    | "arithmetic-expansion";

export interface ShellWordPart extends AstNode {
    kind: "ShellWordPart";
    partKind: ShellWordPartKind;
    quoted: boolean;
}

export interface ShellWord extends AstNode {
    kind: "ShellWord";
    parts: readonly ShellWordPart[];
}

export interface Redirection extends AstNode {
    kind: "Redirection";
    descriptor?: number;
    operator: "<" | ">" | ">>" | "<<" | "<<-" | "<<<" | "<>" | ">&" | "<&";
    target?: ShellWord;
}

export interface CommandInvocation extends AstNode {
    kind: "CommandInvocation";
    words: readonly ShellWord[];
    redirections: readonly Redirection[];
}

export interface Pipeline extends AstNode {
    kind: "Pipeline";
    negated: boolean;
    commands: readonly CommandInvocation[];
    operators: readonly ("|" | "|&")[];
}

export interface CommandList extends AstNode {
    kind: "CommandList";
    pipelines: readonly Pipeline[];
    operators: readonly ("&&" | "||" | ";" | "&")[];
}

export interface CommandOption extends AstNode {
    kind: "CommandOption";
    names: readonly string[];
    valueName?: string;
    valueType?: WizType;
    required: boolean;
    repeatable: boolean;
    conflicts: readonly string[];
    requires: readonly string[];
    subcommand?: string;
}

export interface CommandSignature extends AstNode {
    kind: "CommandSignature";
    parameters: readonly FunctionParameter[];
    resultType: WizType;
}

export interface CommandStatement extends AstNode {
    kind: "CommandStatement";
    name: string;
    arguments: readonly CommandArgument[];
    syntax?: CommandList;
}

/** Imports declarations from an installed Wiz type package without runtime output. */
export interface TypeImportDeclaration extends AstNode {
    kind: "TypeImportDeclaration";
    specifier: string;
}

/** Sources a Wiz module in isolation and imports only explicitly named exports. */
export interface SourceImportDeclaration extends AstNode {
    kind: "SourceImportDeclaration";
    specifier: string;
    imports: readonly string[];
}

export interface EnvironmentDeclaration extends AstNode {
    kind: "EnvironmentDeclaration";
    name: string;
    type: WizType;
    optional: boolean;
}

export interface ExternalCommandMethod extends AstNode {
    kind: "ExternalCommandMethod";
    name: string;
    parameters: readonly FunctionParameter[];
    resultType: WizType;
    options?: readonly CommandOption[];
    overloads?: readonly CommandSignature[];
}

export interface ExternalCommandDeclaration extends AstNode {
    kind: "ExternalCommandDeclaration";
    name: string;
    direct: boolean;
    parameters: readonly FunctionParameter[];
    resultType: WizType;
    methods: readonly ExternalCommandMethod[];
    options?: readonly CommandOption[];
    overloads?: readonly CommandSignature[];
}

export interface RawStatement extends AstNode {
    kind: "RawStatement";
}

export type Statement =
    | TypedVariableDeclaration
    | FunctionDeclaration
    | CommandStatement
    | TypeImportDeclaration
    | SourceImportDeclaration
    | EnvironmentDeclaration
    | ExternalCommandDeclaration
    | RawStatement;

export interface SourceFile {
    kind: "SourceFile";
    fileName: string;
    text: string;
    declarationFile: boolean;
    syntaxTree: SyntaxTree;
    statements: readonly Statement[];
    diagnostics: readonly Diagnostic[];
}
