export interface RegistryServerConfig {
    host: string;
    port: number;
    publicUrl: string;
    databaseUrl: string;
    sessionSecret: string;
    tokenPepper: string;
    passwordPepper: string;
    webauthn: {
        rpId: string;
        rpName: string;
        origin: string;
    };
    smtp: {
        host: string;
        port: number;
        secure: boolean;
        requireTls: boolean;
        username?: string;
        password?: string;
        fromAddress: string;
        fromName: string;
    };
    storage:
        | { driver: "filesystem"; path: string }
        | {
              driver: "s3";
              endpoint?: string;
              region: string;
              bucket: string;
              accessKeyId: string;
              secretAccessKey: string;
          };
    redisUrl?: string;
    rateLimits: {
        authentication: number;
        api: number;
        windowSeconds: number;
    };
    logLevel: "debug" | "info" | "warn" | "error";
    logFormat: "json" | "pretty";
    cors: {
        origins: readonly string[];
        credentials: boolean;
        maxAgeSeconds: number;
    };
    telemetry: {
        enabled: boolean;
        serviceName: string;
        endpoint?: string;
        exportIntervalMilliseconds: number;
    };
    administration: {
        usernames: readonly string[];
    };
}
