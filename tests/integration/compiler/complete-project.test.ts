import { afterEach, expect, test } from "bun:test";
import { cp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { LanguageService } from "@wiz/language-service";
import { temporaryDirectory } from "../../utils/filesystem.ts";
import { runCli } from "../../utils/process.ts";

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

test("complete Wiz project works through config, compiler, tools, runtime and language intelligence", async () => {
    const root = await temporaryDirectory();

    roots.push(root);

    const fixture = join(
        import.meta.dir,
        "../../fixtures/projects/complete-wiz",
    );

    await cp(fixture, root, { recursive: true });

    const home = join(root, ".home");

    const checked = await runCli(root, ["c", "check"], home);

    expect(checked.code).toBe(0);

    expect(checked.stderr).toBe("");

    expect((await runCli(root, ["format", "--check", "."], home)).code).toBe(0);

    expect((await runCli(root, ["lint", "."], home)).code).toBe(0);

    expect((await runCli(root, ["c", "build"], home)).code).toBe(0);

    const main = join(root, "dist/main.sh");

    const helper = join(root, "dist/helpers.sh");

    const expected = join(root, "expected");

    expect(
        JSON.parse(await readFile(join(expected, "diagnostics.json"), "utf8")),
    ).toEqual([]);

    expect(await Bun.file(main).exists()).toBe(true);

    expect(await Bun.file(helper).exists()).toBe(true);

    expect(await Bun.file(`${main}.map`).exists()).toBe(true);

    expect(await readFile(main, "utf8")).toBe(
        await readFile(join(expected, "main.sh"), "utf8"),
    );

    expect(await readFile(helper, "utf8")).toBe(
        await readFile(join(expected, "helpers.sh"), "utf8"),
    );

    expect(JSON.parse(await readFile(`${main}.map`, "utf8"))).toEqual(
        JSON.parse(await readFile(join(expected, "main.sh.map"), "utf8")),
    );

    expect(Bun.spawnSync(["bash", "-n", main]).exitCode).toBe(0);

    expect(Bun.spawnSync(["bash", "-n", helper]).exitCode).toBe(0);

    const executed = Bun.spawnSync(["bash", main], { cwd: root });

    expect(executed.exitCode).toBe(0);

    expect(executed.stdout.toString()).toBe("Hello, Wiz on 8080!\n");

    const service = new LanguageService();

    const helperUri = `file://${join(root, "src/helpers.wiz")}`;

    const mainUri = `file://${join(root, "src/main.wiz")}`;

    const helperSource = await readFile(join(root, "src/helpers.wiz"), "utf8");

    const mainSource = await readFile(join(root, "src/main.wiz"), "utf8");

    service.updateDocument(helperUri, helperSource, 1);

    service.updateDocument(mainUri, mainSource, 1);

    const call = mainSource.indexOf("greet");

    expect(service.hover(mainUri, call + 1)?.contents).toContain(
        "greet(string name, int port): void",
    );

    expect(service.definition(mainUri, call + 1)?.uri).toBe(helperUri);

    expect(
        service.completions(mainUri).map((item) => {
            return item.label;
        }),
    ).toContain("greet");
});
