import * as Sentry from "@sentry/node";

export function initSentry() {
  const dsn = process.env.BUGSINK_DSN_BEXTRACT;
  if (!dsn) {
    console.log("[observability] no BUGSINK_DSN_BEXTRACT - skipping Sentry init");
    return null;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "production",
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
  Sentry.setTag("service", "bextract");
  console.log("[observability] Sentry initialized");
  return Sentry;
}

export function sentryErrorHandler() {
  return (err, req, res, next) => {
    try {
      if (process.env.BUGSINK_DSN_BEXTRACT) Sentry.captureException(err);
    } catch (_) {}
    next(err);
  };
}
