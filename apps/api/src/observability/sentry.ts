import * as Sentry from "@sentry/node";

let sentryEnabled = false;

export function initSentry(params: {
  dsn: string | null;
  environment: string;
}): void {
  if (!params.dsn || sentryEnabled) {
    return;
  }

  Sentry.init({
    dsn: params.dsn,
    environment: params.environment,
    tracesSampleRate: 0,
  });
  sentryEnabled = true;
}

export function captureException(error: unknown): void {
  if (!sentryEnabled) {
    return;
  }
  Sentry.captureException(error);
}

export async function flushSentry(timeoutMs = 2_000): Promise<void> {
  if (!sentryEnabled) {
    return;
  }
  await Sentry.flush(timeoutMs);
}
