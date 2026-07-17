# Repository tools

`json-format.ts` owns Wiz's JSON serialization contract. It parses every repository-owned
`.json` file and writes the exact output of `JSON.stringify(value, null, 4)` with one trailing
newline. Generated dependency and build directories are intentionally excluded.

Use `bun run format:json` to rewrite files or `bun run format:json:check` in automation.
