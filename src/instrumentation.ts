/**
 * Runs once when the Node server starts (Next.js instrumentation hook; REQ-NF-063 ②,
 * DEC-490 ③; CR-20260929-health-logging): one `server.start` line with the build the
 * process was made from, and two listeners that turn an unhandled rejection or uncaught
 * exception into a structured line.
 *
 * Next's own server already registers handlers for both events that `console.error` the
 * reason and keep the process alive (`next-server.js`, "Install a new handler to prevent the
 * process from crashing"); these listeners sit beside them and change nothing about exit
 * behaviour — they only make the event greppable. Skipped on the edge runtime.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { errorFields, logEvent } = await import("./lib/log");
  logEvent("info", "server.start", {
    build: process.env.NEXT_PUBLIC_BUILD_SHA ?? "",
    node: process.version,
    pid: process.pid,
    env: process.env.NODE_ENV ?? "",
  });
  process.on("unhandledRejection", (reason) => {
    logEvent("error", "process.unhandled_rejection", errorFields(reason));
  });
  process.on("uncaughtException", (error) => {
    logEvent("error", "process.uncaught_exception", errorFields(error));
  });
}
