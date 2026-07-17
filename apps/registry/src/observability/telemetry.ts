import { opentelemetry } from "@elysia/opentelemetry";
import { metrics } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { Elysia } from "elysia";
import type { RegistryServerConfig } from "../config/types.ts";

function signalUrl(endpoint: string, signal: "traces" | "metrics"): string {
    return `${endpoint.replace(/\/$/, "")}/v1/${signal}`;
}

/** Creates the global tracing plugin without exporting anything when disabled. */
export function createTelemetryPlugin(
    config: RegistryServerConfig["telemetry"],
) {
    if (!config.enabled) {
        return new Elysia({ name: "wiz-registry-telemetry-disabled" });
    }

    const endpoint = config.endpoint ?? "http://localhost:4318";

    return opentelemetry({
        serviceName: config.serviceName,
        traceExporter: new OTLPTraceExporter({
            url: signalUrl(endpoint, "traces"),
        }),
        metricReader: new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({
                url: signalUrl(endpoint, "metrics"),
            }),
            exportIntervalMillis: config.exportIntervalMilliseconds,
        }),
    });
}

const meter = metrics.getMeter("@wiz/registry");

const requestCounter = meter.createCounter("wiz.registry.http.requests", {
    description: "Completed registry HTTP requests",
});

const requestDuration = meter.createHistogram("wiz.registry.http.duration", {
    description: "Registry HTTP request duration in milliseconds",
    unit: "ms",
});

const authenticationFailureCounter = meter.createCounter(
    "wiz.registry.authentication.failures",
    { description: "Rejected registry authentication attempts" },
);

export function recordHttpRequest(
    method: string,
    route: string,
    status: number,
    durationMilliseconds: number,
): void {
    const attributes = {
        "http.request.method": method,
        "http.route": route,
        "http.response.status_code": status,
    };

    requestCounter.add(1, attributes);
    requestDuration.record(durationMilliseconds, attributes);

    if (status === 401 || status === 403) {
        authenticationFailureCounter.add(1, attributes);
    }
}
