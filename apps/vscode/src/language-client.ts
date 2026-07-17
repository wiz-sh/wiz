import { workspace } from "vscode";
import {
    LanguageClient,
    type LanguageClientOptions,
    type ServerOptions,
} from "vscode-languageclient/node";

export function createLanguageClient(): LanguageClient {
    const executable = workspace
        .getConfiguration("wiz")
        .get<string>("server.path", "wiz");

    const serverOptions: ServerOptions = {
        command: executable,
        args: ["c", "lsp", "--stdio"],
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: "file", language: "wiz" },
            { scheme: "untitled", language: "wiz" },
        ],
        synchronize: {
            configurationSection: ["wiz"],
            fileEvents: [
                workspace.createFileSystemWatcher("**/config.wiz.json"),
                workspace.createFileSystemWatcher("**/*.{wiz,sh,zsh}"),
            ],
        },
    };

    return new LanguageClient(
        "wizLanguageServer",
        "Wiz Language Server",
        serverOptions,
        clientOptions,
    );
}
