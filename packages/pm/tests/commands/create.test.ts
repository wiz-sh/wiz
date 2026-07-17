import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    createProject,
    listProjectTemplates,
    readManifest,
} from "../../src/index.ts";

test("built-in templates create runnable, strict Wiz projects", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "wiz-template-"));

    const destination = join(temporary, "friendly-cli");

    const name = await createProject("basic", destination);

    expect(name).toBe("friendly-cli");

    expect(listProjectTemplates()).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ name: "basic" }),
            expect.objectContaining({ name: "cli" }),
            expect.objectContaining({ name: "library" }),
        ]),
    );

    expect((await readManifest(destination)).package.name).toBe("friendly-cli");

    expect(await readFile(join(destination, "src/main.wiz"), "utf8")).toContain(
        'greet "friendly-cli"',
    );
});

test("user-authored template directories render project variables", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "wiz-user-template-"));

    const template = join(temporary, "template");

    await mkdir(join(template, "src"), { recursive: true });

    await writeFile(
        join(template, "src/index.wiz"),
        "printf '%s\\n' \"{{projectName}}\"\n",
    );

    const destination = join(temporary, "custom-project");

    await createProject(template, destination);

    expect(await readFile(join(destination, "src/index.wiz"), "utf8")).toBe(
        "printf '%s\\n' \"custom-project\"\n",
    );
});
