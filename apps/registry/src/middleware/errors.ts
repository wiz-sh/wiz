export const registryErrorCodes = [
    "AUTHENTICATION_REQUIRED",
    "AUTHENTICATION_FAILED",
    "EMAIL_NOT_VERIFIED",
    "MFA_REQUIRED",
    "MFA_INVALID",
    "SESSION_EXPIRED",
    "TOKEN_EXPIRED",
    "TOKEN_REVOKED",
    "INSUFFICIENT_PERMISSION",
    "VALIDATION_FAILED",
    "RATE_LIMITED",
    "RESOURCE_NOT_FOUND",
    "RESOURCE_CONFLICT",
    "USERNAME_UNAVAILABLE",
    "SCOPE_UNAVAILABLE",
    "PACKAGE_NOT_FOUND",
    "PACKAGE_ACCESS_DENIED",
    "PACKAGE_VERSION_NOT_FOUND",
    "PACKAGE_VERSION_EXISTS",
    "PACKAGE_VERSION_IMMUTABLE",
    "PACKAGE_NAME_INVALID",
    "PACKAGE_ARCHIVE_INVALID",
    "PACKAGE_ARCHIVE_TOO_LARGE",
    "PACKAGE_INTEGRITY_MISMATCH",
    "PACKAGE_QUARANTINED",
    "DIST_TAG_INVALID",
    "ORG_NOT_FOUND",
    "ORG_INVITATION_EXPIRED",
    "ORG_MEMBER_EXISTS",
    "LAST_ORG_OWNER",
    "WEBAUTHN_CHALLENGE_EXPIRED",
    "WEBAUTHN_VERIFICATION_FAILED",
    "TOTP_INVALID",
    "RECOVERY_CODE_INVALID",
    "INTERNAL_ERROR",
] as const;

export type RegistryErrorCode = (typeof registryErrorCodes)[number];

export class RegistryHttpError extends Error {
    readonly code: RegistryErrorCode;

    readonly status: number;

    readonly details?: unknown;

    constructor(
        code: RegistryErrorCode,
        status: number,
        message: string,
        details?: unknown,
    ) {
        super(message);

        this.name = "RegistryHttpError";
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

export function notFound(message = "Resource not found"): RegistryHttpError {
    return new RegistryHttpError("RESOURCE_NOT_FOUND", 404, message);
}

export function authenticationRequired(): RegistryHttpError {
    return new RegistryHttpError(
        "AUTHENTICATION_REQUIRED",
        401,
        "Authentication is required.",
    );
}

export function validationFailed(
    message: string,
    details?: unknown,
): RegistryHttpError {
    return new RegistryHttpError("VALIDATION_FAILED", 400, message, details);
}

export function errorResponse(
    error: RegistryHttpError,
    requestId: string,
): {
    error: {
        code: RegistryErrorCode;
        message: string;
        status: number;
        requestId: string;
        details?: unknown;
    };
} {
    return {
        error: {
            code: error.code,
            message: error.message,
            status: error.status,
            requestId,
            ...(error.details === undefined ? {} : { details: error.details }),
        },
    };
}
