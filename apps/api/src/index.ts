import "dotenv/config";
import cors from "@fastify/cors";
import Fastify from "fastify";

const app = Fastify({ logger: true });
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";
const allowedOrigin = process.env.CORS_ORIGIN ?? "*";

await app.register(cors, {
  origin: allowedOrigin,
});

app.get("/health", async () => {
  return {
    ok: true,
    service: "api",
    timestamp: new Date().toISOString(),
  };
});

app.get("/api/v1/health", async () => {
  return {
    ok: true,
    service: "api",
    version: "v1",
  };
});

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

