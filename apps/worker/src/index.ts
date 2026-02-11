import "dotenv/config";

const intervalMs = Number(process.env.WORKER_HEARTBEAT_MS ?? 30000);

console.log("[worker] started");

setInterval(() => {
  console.log(
    `[worker] heartbeat ${new Date().toISOString()} (placeholder queue loop)`
  );
}, intervalMs);

