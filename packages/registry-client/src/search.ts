import type { RegistryTransport } from "./transport.ts";
import type {
    CursorPage,
    RegistryPackage,
    RegistryPackageSearch,
    RegistryRequestOptions,
} from "./types.ts";

function searchParameters(input: RegistryPackageSearch): URLSearchParams {
    const parameters = new URLSearchParams({ q: input.query });

    for (const [name, value] of Object.entries(input)) {
        if (name === "query" || value === undefined) {
            continue;
        }

        parameters.set(name, String(value));
    }

    return parameters;
}

export class RegistrySearchResource {
    constructor(private readonly transport: RegistryTransport) {}

    packages(
        input: string | RegistryPackageSearch,
        cursorOrOptions?: string | RegistryRequestOptions,
        options: RegistryRequestOptions = {},
    ): Promise<CursorPage<RegistryPackage>> {
        const request =
            typeof cursorOrOptions === "object" ? cursorOrOptions : options;

        const parameters = searchParameters(
            typeof input === "string"
                ? {
                      query: input,
                      ...(typeof cursorOrOptions === "string"
                          ? { cursor: cursorOrOptions }
                          : {}),
                  }
                : input,
        );

        return this.transport.request({
            path: `/v1/search?${parameters}`,
            ...request,
        });
    }
}
