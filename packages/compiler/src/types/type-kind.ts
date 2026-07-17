export type PrimitiveTypeName =
    | "string"
    | "int"
    | "bool"
    | "path"
    | "file"
    | "directory"
    | "bytes"
    | "status"
    | "stream"
    | "void"
    | "any"
    | "unknown"
    | "never";

export type TypeKind =
    | "primitive"
    | "literal"
    | "union"
    | "array"
    | "map"
    | "optional";
