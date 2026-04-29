/**
 * Structured event logger for business analytics.
 * Outputs JSON lines to stdout for easy parsing by log aggregators.
 */
export function logEvent(event: string, data: Record<string, unknown> = {}): void {
  const entry = {
    event,
    timestamp: new Date().toISOString(),
    ...data,
  };
  console.log(JSON.stringify(entry));
}

/**
 * Phase 5+ — leveled structured logger. JSON lines, one per call.
 * Usage:
 *   logger.warn("EVENT_REGISTRATION_FAILED", { code, userId, eventId })
 *   logger.error("WEBHOOK_HANDLER_ERROR", { eventId, err: e.message })
 */
type LogLevel = "debug" | "info" | "warn" | "error";

function emit(level: LogLevel, code: string, data: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    level,
    code,
    timestamp: new Date().toISOString(),
    ...data,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (code: string, data?: Record<string, unknown>) => emit("debug", code, data),
  info:  (code: string, data?: Record<string, unknown>) => emit("info",  code, data),
  warn:  (code: string, data?: Record<string, unknown>) => emit("warn",  code, data),
  error: (code: string, data?: Record<string, unknown>) => emit("error", code, data),
};
