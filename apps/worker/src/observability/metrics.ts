import { createServer } from "node:http";
import type { Server } from "node:http";
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

export type WorkerMetrics = {
  registry: Registry;
  jobsTotal: Counter<"queue" | "status">;
  jobDurationSeconds: Histogram<"queue" | "status">;
  queueDepth: Gauge<"queue">;
  heartbeatTimestampSeconds: Gauge;
};

export function createWorkerMetrics(): WorkerMetrics {
  const registry = new Registry();
  collectDefaultMetrics({
    register: registry,
    prefix: "chessdb_worker_",
  });

  const jobsTotal = new Counter({
    name: "chessdb_worker_jobs_total",
    help: "Count of processed worker jobs",
    labelNames: ["queue", "status"] as const,
    registers: [registry],
  });

  const jobDurationSeconds = new Histogram({
    name: "chessdb_worker_job_duration_seconds",
    help: "Worker job duration in seconds",
    labelNames: ["queue", "status"] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [registry],
  });

  const queueDepth = new Gauge({
    name: "chessdb_queue_depth",
    help: "Approximate queue depth (waiting + active + delayed)",
    labelNames: ["queue"] as const,
    registers: [registry],
  });

  const heartbeatTimestampSeconds = new Gauge({
    name: "chessdb_worker_heartbeat_timestamp_seconds",
    help: "Unix timestamp of the latest worker heartbeat",
    registers: [registry],
  });

  return {
    registry,
    jobsTotal,
    jobDurationSeconds,
    queueDepth,
    heartbeatTimestampSeconds,
  };
}

export function recordJobMetric(
  metrics: WorkerMetrics,
  queue: string,
  status: "completed" | "failed",
  durationMs: number
): void {
  const durationSeconds = Math.max(0, durationMs / 1000);
  metrics.jobsTotal.labels(queue, status).inc();
  metrics.jobDurationSeconds.labels(queue, status).observe(durationSeconds);
}

export function updateQueueDepthMetric(
  metrics: WorkerMetrics,
  queue: string,
  depth: number
): void {
  metrics.queueDepth.labels(queue).set(depth);
}

export function updateHeartbeatMetric(metrics: WorkerMetrics): void {
  metrics.heartbeatTimestampSeconds.set(Date.now() / 1000);
}

export function startWorkerMetricsServer(params: {
  metrics: WorkerMetrics;
  host: string;
  port: number;
  path?: string;
  onError?: (error: Error) => void;
}): Server {
  const path = params.path ?? "/metrics";
  const server = createServer((request, response) => {
    if (!request.url || !request.url.startsWith(path)) {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }

    void (async () => {
      try {
        response.setHeader("content-type", params.metrics.registry.contentType);
        response.statusCode = 200;
        response.end(await params.metrics.registry.metrics());
      } catch (error) {
        response.statusCode = 500;
        response.end("metrics error");
        if (params.onError) {
          params.onError(error as Error);
        }
      }
    })();
  });

  server.listen(params.port, params.host);
  return server;
}
