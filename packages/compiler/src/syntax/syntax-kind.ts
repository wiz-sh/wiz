export enum SyntaxKind {
    SourceFile = "SourceFile",
    WhitespaceToken = "WhitespaceToken",
    NewlineToken = "NewlineToken",
    CommentToken = "CommentToken",
    WordToken = "WordToken",
    NumberToken = "NumberToken",
    SingleQuotedToken = "SingleQuotedToken",
    DoubleQuotedToken = "DoubleQuotedToken",
    ExpansionToken = "ExpansionToken",
    ArithmeticToken = "ArithmeticToken",
    OperatorToken = "OperatorToken",
    HeredocBodyToken = "HeredocBodyToken",
    BadToken = "BadToken",
    EndOfFileToken = "EndOfFileToken",
}

export type LexerMode =
    | "command"
    | "single-quoted"
    | "double-quoted"
    | "parameter-expansion"
    | "arithmetic"
    | "conditional"
    | "heredoc"
    | "type";
