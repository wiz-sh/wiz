import { expect, test } from "bun:test";
import { parseSourceFile } from "@wiz/compiler";
import { formatSourceFile } from "../src/index.ts";

test("incomplete editor source remains formatable", () => {
    const source = 'if true; then\nprintf "unfinished\n';

    const formatted = formatSourceFile(parseSourceFile(source, "editing.wiz"));

    expect(formatted).toContain('    printf "unfinished');
});
