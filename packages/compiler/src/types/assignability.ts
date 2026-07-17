import type { WizType } from "./type.ts";

export function isAssignable(source: WizType, target: WizType): boolean {
    if (
        source.name === target.name ||
        target.name === "any" ||
        target.name === "unknown" ||
        source.name === "any" ||
        source.name === "never"
    ) {
        return true;
    }

    if (target.kind === "union" && target.members !== undefined) {
        return target.members.some((member) => {
            return isAssignable(source, member);
        });
    }

    if (source.kind === "union" && source.members !== undefined) {
        return source.members.every((member) => {
            return isAssignable(member, target);
        });
    }

    if (source.kind === "literal") {
        if (target.kind === "literal") {
            return source.literal === target.literal;
        }

        return target.name === "string";
    }

    if (
        target.name === "string" &&
        ["path", "file", "directory"].includes(source.name)
    ) {
        return true;
    }

    if (source.name === "status" && target.name === "int") {
        return true;
    }

    if (target.kind === "optional" && target.element !== undefined) {
        return source.name === "void" || isAssignable(source, target.element);
    }

    if (
        source.kind === "array" &&
        target.kind === "array" &&
        source.element !== undefined &&
        target.element !== undefined
    ) {
        return isAssignable(source.element, target.element);
    }

    if (
        source.kind === "map" &&
        target.kind === "map" &&
        source.key !== undefined &&
        target.key !== undefined &&
        source.value !== undefined &&
        target.value !== undefined
    ) {
        return (
            isAssignable(source.key, target.key) &&
            isAssignable(source.value, target.value)
        );
    }

    return false;
}
