import type { FastifyInstance } from "fastify";
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

export type ApiMetrics = {
  registry: Registry;
  requestDurationSeconds: Histogram<"method" | "route" | "status">;
  requestTotal: Counter<"method" | "route" | "status">;
  inFlightRequests: Gauge;
};

function normalizeRoute(url: string): string {
  const withoutQuery = url.split("?")[0];
  return withoutQuery.length > 0 ? withoutQuery : "/";
}

export function createApiMetrics(): ApiMetrics {
  const registry = new Registry();
  collectDefaultMetrics({
    register: registry,
    prefix: "chessdb_api_",
  });

  const requestDurationSeconds = new Histogram({
    name: "chessdb_api_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status"] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });

  const requestTotal = new Counter({
    name: "chessdb_api_requests_total",
    help: "Count of HTTP requests",
    labelNames: ["method", "route", "status"] as const,
    registers: [registry],
  });

  const inFlightRequests = new Gauge({
    name: "chessdb_api_inflight_requests",
    help: "Current in-flight HTTP requests",
    registers: [registry],
  });

  return {
    registry,
    requestDurationSeconds,
    requestTotal,
    inFlightRequests,
  };
}

export function registerApiMetrics(
  app: FastifyInstance,
  metrics: ApiMetrics,
  metricsPath: string
): void {
  const startTimes = new WeakMap<object, bigint>();

  app.addHook("onRequest", async (request) => {
    startTimes.set(request.raw, process.hrtime.bigint());
    metrics.inFlightRequests.inc();
  });

  app.addHook("onResponse", async (request, reply) => {
    metrics.inFlightRequests.dec();

    const start = startTimes.get(request.raw);
    if (!start) {
      return;
    }

    const durationNs = process.hrtime.bigint() - start;
    const durationSeconds = Number(durationNs) / 1_000_000_000;
    const route = normalizeRoute(request.routeOptions.url || request.url);
    const status = String(reply.statusCode);
    const method = request.method;

    metrics.requestDurationSeconds
      .labels(method, route, status)
      .observe(durationSeconds);
    metrics.requestTotal.labels(method, route, status).inc();
  });

  app.get(metricsPath, async (_request, reply) => {
    reply.header("content-type", metrics.registry.contentType);
    return reply.send(await metrics.registry.metrics());
  });
}
