import {
    type AstNode,
    type ExternalCommandDeclaration,
    type FunctionDeclaration,
    getDocumentation,
    getStandardLibraryFiles,
} from "@wiz/compiler";
import type { DocumentSnapshot } from "../snapshot.ts";

const standardLibraryFiles = getStandardLibraryFiles();

export function containsNode(
    statements: readonly AstNode[],
    target: AstNode,
): boolean {
    for (const statement of statements) {
        if (statement === target) {
            return true;
        }

        if (statement.kind === "FunctionDeclaration") {
            const declaration = statement as FunctionDeclaration;

            if (
                declaration.parameters.includes(target as never) ||
                containsNode(declaration.body, target)
            ) {
                return true;
            }
        } else if (statement.kind === "ExternalCommandDeclaration") {
            const declaration = statement as ExternalCommandDeclaration;

            if (
                declaration.parameters.includes(target as never) ||
                declaration.methods.includes(target as never) ||
                declaration.methods.some((method) => {
                    return method.parameters.includes(target as never);
                })
            ) {
                return true;
            }
        }
    }

    return false;
}

export function nodeDocumentation(
    documents: readonly DocumentSnapshot[],
    node: AstNode,
): string | undefined {
    const owner = documents.find((document) => {
        return containsNode(document.file.statements, node);
    });

    if (owner !== undefined) {
        return getDocumentation(owner.file, node)?.markdown;
    }

    const library = standardLibraryFiles.find((candidate) => {
        return containsNode(candidate.file.statements, node);
    });

    return library === undefined
        ? undefined
        : getDocumentation(library.file, node)?.markdown;
}

export function ownerOf(
    documents: readonly DocumentSnapshot[],
    node: AstNode,
): DocumentSnapshot | undefined {
    return documents.find((document) => {
        return containsNode(document.file.statements, node);
    });
}

export function documentationProperty(documentation: string | undefined): {
    documentation?: string;
} {
    return documentation === undefined ? {} : { documentation };
}
