import { loadSourceMap, mapGeneratedToSource } from "@wiz/compiler";
import { WizError } from "@wiz/pm";

/** Maps a generated shell line back to its original Wiz source position. */
export async function mapPosition(value: string | undefined): Promise<number> {
    if (value === undefined) {
        throw new WizError("Missing generated file and line");
    }

    const separator = value.lastIndexOf(":");

    const file = separator < 0 ? value : value.slice(0, separator);

    const line = separator < 0 ? 1 : Number(value.slice(separator + 1));

    if (!Number.isInteger(line) || line < 1) {
        throw new WizError(`Invalid generated line: ${value}`);
    }

    const generated = await Bun.file(file).text();

    const offset = generated
        .split("\n")
        .slice(0, Math.max(0, line - 1))
        .reduce((total, current) => {
            return total + current.length + 1;
        }, 0);

    const map = loadSourceMap(await Bun.file(`${file}.map`).text());

    const position = mapGeneratedToSource(map, offset);

    if (position === undefined) {
        throw new WizError("Position is not mapped");
    }

    console.log(
        `${map.sourceFile}:${position.line + 1}:${position.column + 1}`,
    );

    return 0;
}
