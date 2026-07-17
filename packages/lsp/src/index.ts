#!/usr/bin/env bun
export type { Position, Range } from "./documents.ts";
export { offsetAt, positionAt, rangeAt } from "./documents.ts";
export { LspServer, serveStdio } from "./server.ts";

import { serveStdio } from "./server.ts";

if (import.meta.main) {
    await serveStdio();
}
