import type { PrimitiveTypeName, TypeKind } from "./type-kind.ts";

export interface WizType {
    kind: TypeKind;
    name: string;
    primitive?: PrimitiveTypeName;
    literal?: string;
    members?: readonly WizType[];
    element?: WizType;
    key?: WizType;
    value?: WizType;
}
