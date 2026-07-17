import { expect, test } from "bun:test";
import { join } from "node:path";
import {
    checkProgram,
    createProgram,
    emitProgram,
    getDiagnostics,
} from "../../../packages/compiler/src/index.ts";

function standardLibraryCode(): string {
    const root = join(import.meta.dir, "../../../wiz/stdlib");

    const program = checkProgram(
        createProgram([join(root, "index.wiz")], {
            target: "bash",
            projectRoot: root,
            rootDir: root,
            bundle: true,
            runtimeChecks: "none",
        }),
    );

    expect(getDiagnostics(program)).toEqual([]);

    const result = emitProgram(program);

    expect(result.emitSkipped).toBe(false);

    return result.files[0]?.code ?? "";
}

test("stdlib project and WebSocket helpers execute through compiled Bash", () => {
    const code = standardLibraryCode();

    const accept = Bun.spawnSync([
        "bash",
        "-c",
        `${code}\nwiz_websocket_accept_key 'dGhlIHNhbXBsZSBub25jZQ=='`,
    ]);

    expect(accept.exitCode).toBe(0);

    expect(accept.stdout.toString().trim()).toBe(
        "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=",
    );

    const project = Bun.spawnSync(["bash", "-c", `${code}\nwiz_project_root`], {
        cwd: join(import.meta.dir, "../../fixtures/projects/complete-wiz/src"),
    });

    expect(project.exitCode).toBe(0);

    expect(project.stdout.toString().trim()).toEndWith("complete-wiz");
});

test("netcat stdlib serves an HTTP response end to end", async () => {
    const code = standardLibraryCode();

    const port = 24_000 + Math.floor(Math.random() * 2_000);

    const server = Bun.spawn([
        "bash",
        "-c",
        `${code}\nwiz_http_serve_once ${port} 200 OK text/plain 'Hello from Wiz'`,
    ]);

    let responseBody = "";

    let responseError = "Server did not accept a connection";

    let responseCode = -1;

    for (let attempt = 0; attempt < 30; attempt += 1) {
        const response = Bun.spawnSync([
            "curl",
            "--fail",
            "--silent",
            "--show-error",
            "--max-time",
            "1",
            `http://127.0.0.1:${port}/`,
        ]);

        responseBody = response.stdout.toString();

        responseError = response.stderr.toString();

        responseCode = response.exitCode;

        if (responseCode === 0) {
            break;
        }

        await Bun.sleep(100);
    }

    expect(responseError).toBe("");

    expect(responseCode).toBe(0);

    expect(responseBody).toBe("Hello from Wiz");

    expect(await server.exited).toBe(0);
});
