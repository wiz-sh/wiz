export interface RequestContext {
    requestId: string;
    startedAt: number;
    clientVersion?: string;
}

export function createRequestContext(request: Request): RequestContext {
    const supplied = request.headers.get("x-request-id");

    const clientVersion = request.headers.get("user-agent");

    return {
        requestId:
            supplied !== null && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
                ? supplied
                : `req_${crypto.randomUUID()}`,
        startedAt: performance.now(),
        ...(clientVersion === null ? {} : { clientVersion }),
    };
}

export function requestDuration(context: RequestContext): number {
    return Number((performance.now() - context.startedAt).toFixed(2));
}
