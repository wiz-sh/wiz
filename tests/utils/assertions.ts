import { expect } from "bun:test";

export function expectSuccess(result: { code: number; stderr: string }): void {
    expect(result.code).toBe(0);

    expect(result.stderr).toBe("");
}
