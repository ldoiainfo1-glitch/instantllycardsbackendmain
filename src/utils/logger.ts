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
