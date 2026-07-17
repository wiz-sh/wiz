import { expect, test } from "bun:test";
import { RegistryLogger } from "../src/observability/logger.ts";

test("structured logging redacts nested and configured secrets", () => {
    const lines: string[] = [];

    const logger = new RegistryLogger(
        { logLevel: "debug", logFormat: "json" },
        {
            writer: (line) => {
                lines.push(line);
            },
            secrets: ["a-configured-secret"],
        },
    );

    logger.error("request failed with a-configured-secret", {
        requestId: "req_test",
        password: "hunter2",
        error: {
            message: "a-configured-secret",
            nested: { authorization: "Bearer secret" },
        },
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("hunter2");
    expect(lines[0]).not.toContain("a-configured-secret");
    expect(lines[0]).not.toContain("Bearer secret");
    expect(lines[0]).toContain("[REDACTED]");
});

test("the configured log level suppresses lower-severity events", () => {
    const lines: string[] = [];

    const logger = new RegistryLogger(
        { logLevel: "warn", logFormat: "json" },
        {
            writer: (line) => {
                lines.push(line);
            },
        },
    );

    logger.debug("hidden");
    logger.info("hidden");
    logger.warn("visible");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("visible");
});
