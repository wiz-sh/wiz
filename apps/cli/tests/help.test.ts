import { expect, test } from "bun:test";
import { main } from "../src/cli.ts";

test("version exits successfully", async () => {
    const exitCode = await main(["--version"]);

    expect(exitCode).toBe(0);
});

test("root and command help exit successfully", async () => {
    const rootExitCode = await main(["--help"]);

    const initExitCode = await main(["init", "--help"]);

    const installExitCode = await main(["install", "--help"]);

    const installAliasExitCode = await main(["i", "--help"]);

    const removeExitCode = await main(["remove", "--help"]);

    const rmExitCode = await main(["rm", "--help"]);

    const cleanExitCode = await main(["clean", "--help"]);

    const linkExitCode = await main(["link", "--help"]);

    const unlinkExitCode = await main(["unlink", "--help"]);

    const dlxExitCode = await main(["dlx", "--help"]);

    const unsupportedExitCode = await main(["unsupported", "--help"]);

    const compilerExitCode = await main(["c", "--help"]);

    const formatterExitCode = await main(["fmt", "--help"]);

    const linterExitCode = await main(["lint", "--help"]);

    expect(rootExitCode).toBe(0);

    expect(initExitCode).toBe(0);

    expect(installExitCode).toBe(0);

    expect(installAliasExitCode).toBe(0);

    expect(removeExitCode).toBe(0);

    expect(rmExitCode).toBe(0);

    expect(cleanExitCode).toBe(0);

    expect(linkExitCode).toBe(0);

    expect(unlinkExitCode).toBe(0);

    expect(dlxExitCode).toBe(0);

    expect(unsupportedExitCode).toBe(0);

    expect(compilerExitCode).toBe(0);

    expect(formatterExitCode).toBe(0);

    expect(linterExitCode).toBe(0);
});

test("missing required arguments fail", async () => {
    expect(main(["run"])).rejects.toThrow("Missing executable path");

    expect(main(["script"])).rejects.toThrow("Missing script name");

    expect(main(["bin"])).rejects.toThrow("Usage: wiz bin");
});

test("unsupported commands fail", async () => {
    expect(main(["wat"])).rejects.toThrow("Unknown command");

    expect(main(["init", "--wat"])).rejects.toThrow("Unsupported init option");

    expect(main(["init", "one", "two"])).rejects.toThrow(
        "Unexpected init argument",
    );
});
