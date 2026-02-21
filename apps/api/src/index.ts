import { loadEnv } from "./env.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { captureException, flushSentry, initSentry } from "./observability/sentry.js";

loadEnv();
const config = loadConfig();
initSentry({
  dsn: config.sentryDsn,
  environment: config.sentryEnvironment,
});
const app = await buildApp({ config });

process.on("uncaughtException", (error) => {
  captureException(error);
  app.log.error(error);
});

process.on("unhandledRejection", (reason) => {
  captureException(reason);
  app.log.error({ err: reason }, "Unhandled promise rejection");
});

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  captureException(error);
  await flushSentry();
  app.log.error(error);
  process.exit(1);
}
