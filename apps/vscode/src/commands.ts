import {
    commands,
    type ExtensionContext,
    ProgressLocation,
    type Terminal,
    window,
    workspace,
} from "vscode";

const terminals = new Map<string, Terminal>();

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function executable(): string {
    return workspace.getConfiguration("wiz").get<string>("server.path", "wiz");
}

function projectDirectory(): string | undefined {
    const active = window.activeTextEditor?.document.uri;

    const activeWorkspace =
        active === undefined ? undefined : workspace.getWorkspaceFolder(active);

    return (
        activeWorkspace?.uri.fsPath ??
        workspace.workspaceFolders?.[0]?.uri.fsPath
    );
}

function runInTerminal(name: string, argumentsText: string): void {
    const directory = projectDirectory();

    if (directory === undefined) {
        void window.showWarningMessage(
            "Open a Wiz workspace before running project commands.",
        );

        return;
    }

    const terminalKey = `${name}:${directory}`;

    const existing = terminals.get(terminalKey);

    const terminal =
        existing?.exitStatus === undefined
            ? existing
            : window.createTerminal({ name, cwd: directory });

    const activeTerminal =
        terminal ?? window.createTerminal({ name, cwd: directory });

    terminals.set(terminalKey, activeTerminal);

    const reveal = workspace
        .getConfiguration("wiz")
        .get<boolean>("commands.revealTerminal", true);

    if (reveal) {
        activeTerminal.show(true);
    }

    activeTerminal.sendText(`${shellQuote(executable())} ${argumentsText}`);
}

export function registerCommands(
    context: ExtensionContext,
    restart: () => Promise<void>,
): void {
    context.subscriptions.push(
        commands.registerCommand("wiz.restartLanguageServer", async () => {
            await window.withProgress(
                {
                    location: ProgressLocation.Notification,
                    title: "Restarting Wiz language server",
                },
                restart,
            );

            void window.showInformationMessage(
                "Wiz language server restarted.",
            );
        }),
        commands.registerCommand("wiz.formatDocument", async () => {
            await commands.executeCommand("editor.action.formatDocument");
        }),
        commands.registerCommand("wiz.lintFix", () => {
            const path = window.activeTextEditor?.document.uri.fsPath;

            runInTerminal(
                "Wiz Lint",
                `lint --fix ${path === undefined ? "." : shellQuote(path)}`,
            );
        }),
        commands.registerCommand("wiz.build", () => {
            runInTerminal("Wiz Build", "c build");
        }),
        commands.registerCommand("wiz.check", () => {
            runInTerminal("Wiz Check", "c check");
        }),
        window.onDidCloseTerminal((terminal) => {
            for (const [key, value] of terminals) {
                if (value === terminal) {
                    terminals.delete(key);
                }
            }
        }),
    );
}
