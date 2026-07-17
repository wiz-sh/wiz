import { expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LanguageService } from "../src/index.ts";

test("definitions cross open source-file boundaries", () => {
    const service = new LanguageService();

    const helperUri = "file:///workspace/helpers.wiz";

    const mainUri = "file:///workspace/main.wiz";

    const main = 'source -I greet -- "./helpers.wiz"\ngreet "Wiz"\n';

    service.updateDocument(
        helperUri,
        "greet(string name): void { printf '%s\\n' \"$name\"; }\nexport -f greet\n",
        1,
    );

    service.updateDocument(mainUri, main, 1);

    expect(
        service.definition(mainUri, main.lastIndexOf("greet") + 2)?.uri,
    ).toBe(helperUri);
});

test("scoped sources hide private symbols and diagnose unavailable imports", () => {
    const service = new LanguageService();

    const helperUri = "file:///workspace/module.wiz";

    const mainUri = "file:///workspace/main.wiz";

    service.updateDocument(
        helperUri,
        `public_api(): void { printf 'public\\n'; }
private_api(): void { printf 'private\\n'; }
export -f public_api
`,
        1,
    );

    service.updateDocument(
        mainUri,
        'source -I private_api -- "./module.wiz"\n',
        1,
    );

    expect(service.diagnostics(mainUri)).toContainEqual(
        expect.objectContaining({
            code: "WIZ3004",
            message: "Module does not export private_api",
        }),
    );

    expect(
        service.completions(mainUri).map((completion) => {
            return completion.label;
        }),
    ).not.toContain("private_api");
});

test("literal sources provide IntelliSense without opening the dependency", async () => {
    const root = join(import.meta.dir, `.tmp-${crypto.randomUUID()}`);

    const helperPath = join(root, "helpers.wiz");

    const mainPath = join(root, "main.wiz");

    const helperUri = pathToFileURL(helperPath).href;

    const mainUri = pathToFileURL(mainPath).href;

    const main = `source "./helpers.wiz"
greet "sourced Wiz"
`;

    await mkdir(root, { recursive: true });

    await writeFile(
        helperPath,
        `## Prints a friendly greeting.
## @param name Person or project to greet.
## @example greet "Wiz"
greet(string name): void {
    printf '%s\\n' "$name"
}
`,
    );

    try {
        const service = new LanguageService();

        service.updateDocument(mainUri, main, 1);

        const call = main.lastIndexOf("greet") + 2;

        expect(service.documents.get(helperUri)).toBeDefined();

        expect(service.diagnostics(mainUri)).toEqual([]);

        expect(service.hover(mainUri, call)?.contents).toContain(
            "greet(string name): void",
        );

        expect(service.hover(mainUri, call)?.contents).toContain(
            "Prints a friendly greeting.",
        );

        expect(service.definition(mainUri, call)?.uri).toBe(helperUri);

        expect(service.signatureHelp(mainUri, main.length - 1)).toEqual(
            expect.objectContaining({
                label: "greet(string name): void",
                documentation: expect.stringContaining(
                    "Person or project to greet.",
                ),
            }),
        );

        expect(service.completions(mainUri)).toContainEqual(
            expect.objectContaining({
                label: "greet",
                documentation: expect.stringContaining(
                    '**Example:** `greet "Wiz"`',
                ),
            }),
        );

        await writeFile(
            helperPath,
            `welcome(string name): void {
    printf '%s\\n' "$name"
}
`,
        );

        service.documents.refresh();

        const refreshed = service.completions(mainUri).map((completion) => {
            return completion.label;
        });

        expect(refreshed).toContain("welcome");

        expect(refreshed).not.toContain("greet");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("installed type packages provide IntelliSense through source -T", async () => {
    const root = join(import.meta.dir, `.tmp-${crypto.randomUUID()}`);

    const packageRoot = join(root, "wiz_modules/@types/python");

    const declarationPath = join(packageRoot, "uv.d.wiz");

    const mainPath = join(root, "main.wiz");

    const mainUri = pathToFileURL(mainPath).href;

    const declarationUri = pathToFileURL(declarationPath).href;

    const main = `source -T "@types/python/uv"
uv run pytest
`;

    await mkdir(packageRoot, { recursive: true });

    await writeFile(
        declarationPath,
        `## Runs a command in the project environment.
declare command uv {
    run(command: string, ...arguments: string[]): status
}
`,
    );

    try {
        const service = new LanguageService();

        service.updateDocument(mainUri, main, 1);

        const call = main.lastIndexOf("uv") + 1;

        expect(service.documents.get(declarationUri)).toBeDefined();

        expect(service.diagnostics(mainUri)).toEqual([]);

        expect(service.definition(mainUri, call)?.uri).toBe(declarationUri);

        expect(service.hover(mainUri, call)?.contents).toContain("uv: status");

        expect(service.completions(mainUri)).toContainEqual(
            expect.objectContaining({
                label: "uv",
            }),
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("rename produces precise cross-file edits without touching shadows", () => {
    const service = new LanguageService();

    const declarationUri = "file:///workspace/helpers.wiz";

    const consumerUri = "file:///workspace/main.wiz";

    const declaration = `serve(string name): status {
    printf '%s\\n' "$name"
}
shadow(string serve): void {
    printf '%s\\n' "$serve"
}
`;

    const consumer = `source -I serve -- "./helpers.wiz"
serve "web"
printf '%s\\n' 'serve'
`;

    service.updateDocument(
        declarationUri,
        `${declaration}export -f serve\n`,
        1,
    );

    service.updateDocument(consumerUri, consumer, 1);

    const call = consumer.indexOf("serve", consumer.indexOf("\n"));

    const exportStart = declaration.length + "export -f ".length;

    const edits = service.rename(consumerUri, call + 2, "start");

    expect(edits).toEqual([
        {
            uri: declarationUri,
            range: { start: 0, end: 5 },
            newText: "start",
        },
        {
            uri: declarationUri,
            range: { start: exportStart, end: exportStart + 5 },
            newText: "start",
        },
        {
            uri: consumerUri,
            range: { start: 10, end: 15 },
            newText: "start",
        },
        {
            uri: consumerUri,
            range: { start: call, end: call + 5 },
            newText: "start",
        },
    ]);
});
