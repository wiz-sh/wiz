import { afterAll, expect, mock, test } from "bun:test";

const registeredCommands: string[] = [];

const clients: FakeLanguageClient[] = [];

class FakeLanguageClient {
    started = false;
    stopped = false;

    constructor() {
        clients.push(this);
    }

    onDidChangeState(_listener: (event: { newState: number }) => void): {
        dispose(): void;
    } {
        return { dispose() {} };
    }

    async start(): Promise<void> {
        this.started = true;
    }

    async stop(): Promise<void> {
        this.stopped = true;
    }

    async setTrace(): Promise<void> {}
}

mock.module("vscode", () => {
    return {
        commands: {
            executeCommand: async () => undefined,
            registerCommand: (name: string) => {
                registeredCommands.push(name);

                return { dispose() {} };
            },
        },
        ProgressLocation: { Notification: 15 },
        StatusBarAlignment: { Left: 1 },
        window: {
            activeTextEditor: undefined,
            createStatusBarItem: () => {
                return {
                    command: undefined,
                    name: "",
                    text: "",
                    tooltip: "",
                    dispose() {},
                    show() {},
                };
            },
            createTerminal: () => {
                return {
                    exitStatus: undefined,
                    sendText() {},
                    show() {},
                };
            },
            onDidCloseTerminal: () => {
                return { dispose() {} };
            },
            showErrorMessage: async () => undefined,
            showInformationMessage: async () => undefined,
            showWarningMessage: async () => undefined,
            withProgress: async (
                _options: unknown,
                task: () => Promise<void>,
            ) => task(),
        },
        workspace: {
            createFileSystemWatcher: () => {
                return { dispose() {} };
            },
            getConfiguration: () => {
                return {
                    get: (_name: string, fallback: unknown) => fallback,
                };
            },
            getWorkspaceFolder: () => undefined,
            onDidChangeConfiguration: () => {
                return { dispose() {} };
            },
            workspaceFolders: [],
        },
    };
});

mock.module("vscode-languageclient/node", () => {
    return {
        LanguageClient: FakeLanguageClient,
        State: { Starting: 1, Running: 2, Stopped: 3 },
        Trace: { Off: 0, Messages: 1, Verbose: 2 },
    };
});

afterAll(() => {
    mock.restore();
});

test("activation starts the language client and registers every command", async () => {
    const extension = await import("../src/extension.ts");

    const context = {
        subscriptions: [],
    } as never;

    await extension.activate(context);

    expect(clients).toHaveLength(1);

    expect(clients[0]?.started).toBe(true);

    expect(registeredCommands).toEqual([
        "wiz.restartLanguageServer",
        "wiz.formatDocument",
        "wiz.lintFix",
        "wiz.build",
        "wiz.check",
    ]);

    await extension.deactivate();

    expect(clients[0]?.stopped).toBe(true);
});
