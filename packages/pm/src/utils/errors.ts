export class WizError extends Error {
    public readonly exitCode: number;

    public constructor(message: string, exitCode = 1) {
        super(message);

        this.name = "WizError";

        this.exitCode = exitCode;
    }
}

export interface CodedError extends Error {
    code?: string;
}

export function errorMessage(err: Error): string {
    return err.message;
}

export function isCodedError(err: Error): err is CodedError {
    if (!("code" in err)) {
        return false;
    }

    return err.code === undefined || typeof err.code === "string";
}
