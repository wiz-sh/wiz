const composeFile = "docker-compose.dev.yml";

const keepEnvironment = process.env.WIZ_E2E_KEEP_ENVIRONMENT === "true";

interface CommandOptions {
    allowFailure?: boolean;
    environment?: Record<string, string>;
}

async function run(
    command: readonly string[],
    options: CommandOptions = {},
): Promise<number> {
    const processHandle = Bun.spawn([...command], {
        cwd: import.meta.dir.endsWith("/tools")
            ? `${import.meta.dir}/..`
            : process.cwd(),
        env: {
            ...process.env,
            ...options.environment,
        },
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });

    const exitCode = await processHandle.exited;

    if (exitCode !== 0 && options.allowFailure !== true) {
        throw new Error(
            `Command failed with exit code ${exitCode}: ${command.join(" ")}`,
        );
    }

    return exitCode;
}

async function compose(...arguments_: readonly string[]): Promise<number> {
    return run(["docker", "compose", "-f", composeFile, ...arguments_]);
}

async function test(): Promise<void> {
    await run(
        [
            "bun",
            "test",
            "./apps/registry/tests/e2e/api.e2e.ts",
            "./apps/registry/tests/e2e/account.e2e.ts",
            "./apps/registry/tests/e2e/mfa.e2e.ts",
            "./apps/registry/tests/e2e/security.e2e.ts",
            "./apps/registry/tests/e2e/database.e2e.ts",
            "./apps/registry/tests/e2e/email.e2e.ts",
            "./apps/registry/tests/e2e/operations.e2e.ts",
        ],
        {
            environment: {
                WIZ_REGISTRY_E2E_URL: "http://localhost:53000",
                WIZ_MAILPIT_URL: "http://localhost:58025",
                REGISTRY_DATABASE_TEST_URL:
                    "postgres://wiz_test:wiz-development-database-password@localhost:55432/wiz_test",
                SMTP_HOST: "localhost",
                SMTP_PORT: "51025",
                SMTP_SECURE: "false",
                SMTP_REQUIRE_TLS: "false",
            },
        },
    );

    await run(["bun", "run", "./tools/registry-webauthn-e2e.ts"], {
        environment: {
            WIZ_REGISTRY_E2E_URL: "http://registry.test.localhost:53000",
            WIZ_MAILPIT_URL: "http://localhost:58025",
        },
    });

    await run([
        "bun",
        "test",
        "./packages/registry-client/tests",
        "./apps/registry/tests",
    ]);
}

async function main(): Promise<void> {
    let failed = false;

    try {
        await compose("down", "--volumes", "--remove-orphans");

        await compose("up", "--build", "--wait");

        await test();
    } catch (err) {
        failed = true;

        console.error(err instanceof Error ? err.message : String(err));

        await run(
            [
                "docker",
                "compose",
                "-f",
                composeFile,
                "logs",
                "--no-color",
                "--tail=500",
            ],
            { allowFailure: true },
        );
    } finally {
        if (keepEnvironment) {
            console.info(
                "WIZ_E2E_KEEP_ENVIRONMENT=true; preserving registry containers and volumes.",
            );
        } else {
            await run(
                [
                    "docker",
                    "compose",
                    "-f",
                    composeFile,
                    "down",
                    "--volumes",
                    "--remove-orphans",
                ],
                { allowFailure: true },
            );
        }
    }

    if (failed) {
        process.exitCode = 1;
    }
}

main();
