import { afterEach, expect, test } from "bun:test";
import { realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { temporaryDirectory } from "../../utils/filesystem.ts";
import { runCli } from "../../utils/process.ts";

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

test("Wiz CLI initializes, runs, maps, formats stdin, and validates options", async () => {
    const root = await temporaryDirectory("wiz-language-cli-");

    roots.push(root);

    const home = join(root, ".home");

    const initialized = await runCli(root, ["c", "init"], home);

    expect(initialized.code).toBe(0);

    expect(await Bun.file(join(root, "config.wiz.json")).exists()).toBe(true);

    expect(await Bun.file(join(root, "src/main.wiz")).exists()).toBe(true);

    const configured = await runCli(root, ["c", "config"], home);

    const canonicalRoot = await realpath(root);

    expect(configured.code).toBe(0);

    expect(JSON.parse(configured.stdout)).toEqual(
        expect.objectContaining({
            projectRoot: canonicalRoot,
            compiler: expect.objectContaining({ target: "bash" }),
        }),
    );

    const executed = await runCli(
        root,
        ["c", "run", "src/main.wiz", "--", "ignored"],
        home,
    );

    expect(executed).toEqual(
        expect.objectContaining({
            code: 0,
            stdout: "Hello, world!\n",
            stderr: "",
        }),
    );

    const direct = await runCli(root, ["src/main.wiz"], home);

    expect(direct).toEqual(
        expect.objectContaining({
            code: 0,
            stdout: "Hello, world!\n",
            stderr: "",
        }),
    );

    const rootRun = await runCli(root, ["run", "src/main.wiz"], home);

    expect(rootRun.code).toBe(0);

    expect((await runCli(root, ["check"], home)).code).toBe(0);

    expect((await runCli(root, ["c", "build"], home)).code).toBe(0);

    const mapped = await runCli(root, ["c", "map", "dist/main.sh:3"], home);

    expect(mapped.code).toBe(0);

    expect(mapped.stdout).toContain("src/main.wiz:");

    const formatted = await runCli(
        root,
        ["format", "--stdin-file-path", "src/main.wiz"],
        home,
        "serve(string name): status {\nprintf '%s\\n' \"$name\"\n}\n",
    );

    expect(formatted.code).toBe(0);

    expect(formatted.stdout).toContain("    printf");

    expect(
        (await runCli(root, ["c", "build", "--wat"], home)).stderr,
    ).toContain("Unknown option");

    expect((await runCli(root, ["c", "lsp"], home)).stderr).toContain(
        "wiz c lsp --stdio",
    );
});

async function readBuilds(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    initial: string,
    expectedCount: number,
): Promise<string> {
    const decoder = new TextDecoder();

    let output = initial;

    while (
        (output.match(/Wiz build completed/g) ?? []).length < expectedCount
    ) {
        const next = await readWithTimeout(reader);

        if (next.done) {
            throw new Error(`Wiz watch exited early: ${output}`);
        }

        output += decoder.decode(next.value, { stream: true });
    }

    return output;
}

async function readOccurrences(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    initial: string,
    value: string,
    expectedCount: number,
): Promise<string> {
    const decoder = new TextDecoder();

    let output = initial;

    while (
        (output.match(new RegExp(value, "g")) ?? []).length < expectedCount
    ) {
        const next = await readWithTimeout(reader);

        if (next.done) {
            throw new Error(`Wiz watch program exited early: ${output}`);
        }

        output += decoder.decode(next.value, { stream: true });
    }

    return output;
}

function readWithTimeout(
    reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Bun.ReadableStreamDefaultReadResult<Uint8Array>> {
    return new Promise((resolveRead, rejectRead) => {
        const timeout = setTimeout(() => {
            rejectRead(new Error("Timed out waiting for Wiz watch build"));
        }, 10_000);

        reader.read().then(
            (result) => {
                clearTimeout(timeout);

                resolveRead(result);
            },
            (error: unknown) => {
                clearTimeout(timeout);

                rejectRead(error);
            },
        );
    });
}

test("Wiz watch rebuilds changed sources and exits cleanly on signals", async () => {
    const root = await temporaryDirectory("wiz-language-watch-");

    roots.push(root);

    const home = join(root, ".home");

    expect((await runCli(root, ["c", "init"], home)).code).toBe(0);

    const cliPath = new URL("../../../apps/cli/src/cli.ts", import.meta.url)
        .pathname;

    const processHandle = Bun.spawn(["bun", cliPath, "watch", "src/main.wiz"], {
        cwd: root,
        env: {
            ...process.env,
            HOME: home,
            WIZ_HOME: join(home, ".wiz"),
        },
        stdout: "pipe",
        stderr: "pipe",
    });

    const reader = processHandle.stderr.getReader();

    const stdoutReader = processHandle.stdout.getReader();

    let output = "";

    let runtimeOutput = "";

    try {
        output = await readBuilds(reader, output, 1);

        runtimeOutput = await readOccurrences(
            stdoutReader,
            runtimeOutput,
            "Hello, world!",
            1,
        );

        const sourcePath = join(root, "src/main.wiz");

        const source = await Bun.file(sourcePath).text();

        await writeFile(sourcePath, `${source}# rebuilt\n`);

        output = await readBuilds(reader, output, 2);

        runtimeOutput = await readOccurrences(
            stdoutReader,
            runtimeOutput,
            "Hello, world!",
            2,
        );
    } finally {
        processHandle.kill("SIGTERM");
    }

    expect(await processHandle.exited).toBe(0);

    expect((output.match(/Wiz build completed/g) ?? []).length).toBeGreaterThan(
        1,
    );

    expect((runtimeOutput.match(/Hello, world!/g) ?? []).length).toBe(2);
}, 15_000);
