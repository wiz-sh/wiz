import {
    commands,
    type Disposable,
    type ExtensionContext,
    StatusBarAlignment,
    window,
    workspace,
} from "vscode";
import { type LanguageClient, State, Trace } from "vscode-languageclient/node";
import { registerCommands } from "./commands.ts";
import { createLanguageClient } from "./language-client.ts";

let client: LanguageClient | undefined;

let stateSubscription: Disposable | undefined;

function configuredTrace(): Trace {
    const trace = workspace
        .getConfiguration("wiz")
        .get<string>("server.trace", "off");

    if (trace === "verbose") {
        return Trace.Verbose;
    }

    if (trace === "messages") {
        return Trace.Messages;
    }

    return Trace.Off;
}

/** Starts the thin editor client and owns its restart-safe lifecycle. */
export async function activate(context: ExtensionContext): Promise<void> {
    const status = window.createStatusBarItem(StatusBarAlignment.Left, 10);

    status.name = "Wiz Language Server";
    status.command = "wiz.restartLanguageServer";
    status.text = "$(loading~spin) Wiz";
    status.tooltip = "Wiz language server is starting";
    status.show();

    let lifecycle = Promise.resolve();

    const start = async (): Promise<void> => {
        status.text = "$(loading~spin) Wiz";
        status.tooltip = "Wiz language server is starting";

        const next = createLanguageClient();

        client = next;

        stateSubscription?.dispose();

        stateSubscription = next.onDidChangeState((event) => {
            if (event.newState === State.Running) {
                status.text = "$(check) Wiz";
                status.tooltip = "Wiz language server is running";
            } else if (event.newState === State.Stopped) {
                status.text = "$(error) Wiz";
                status.tooltip =
                    "Wiz language server stopped; click to restart";
            } else {
                status.text = "$(loading~spin) Wiz";
            }
        });

        try {
            await next.start();

            await next.setTrace(configuredTrace());
        } catch (err) {
            client = undefined;

            stateSubscription.dispose();

            stateSubscription = undefined;

            status.text = "$(error) Wiz";
            status.tooltip =
                "Wiz language server could not start; click to retry";

            const message = err instanceof Error ? err.message : String(err);

            const selected = await window.showErrorMessage(
                `Wiz language server could not start: ${message}`,
                "Open Settings",
            );

            if (selected === "Open Settings") {
                await commands.executeCommand(
                    "workbench.action.openSettings",
                    "wiz.server.path",
                );
            }
        }
    };

    const restart = (): Promise<void> => {
        lifecycle = lifecycle
            .catch(() => undefined)
            .then(async () => {
                const previous = client;

                client = undefined;

                stateSubscription?.dispose();

                stateSubscription = undefined;

                try {
                    await previous?.stop();
                } catch (err) {
                    const message =
                        err instanceof Error ? err.message : String(err);

                    void window.showWarningMessage(
                        `The previous Wiz language server did not stop cleanly: ${message}`,
                    );
                }

                await start();
            });

        return lifecycle;
    };

    await start();

    registerCommands(context, restart);

    context.subscriptions.push(
        status,
        workspace.onDidChangeConfiguration(async (event) => {
            if (event.affectsConfiguration("wiz.server.path")) {
                await restart();
            } else if (event.affectsConfiguration("wiz.server.trace")) {
                await client?.setTrace(configuredTrace());
            }
        }),
    );
}

export async function deactivate(): Promise<void> {
    const active = client;

    client = undefined;

    stateSubscription?.dispose();

    stateSubscription = undefined;

    await active?.stop();
}
