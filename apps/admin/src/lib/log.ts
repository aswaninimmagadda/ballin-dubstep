import 'server-only';
import { headers } from 'next/headers';
import { createLogger, isLogLevel, type LogFields, type Logger } from '@gymflow/core';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * The app-wide logger. Lines go to stdout as JSON; see docs/OPERATIONS.md for
 * what to ship them to and which events are worth an alert.
 */
export const log: Logger = createLogger({
  minLevel: isLogLevel(process.env.LOG_LEVEL) ? process.env.LOG_LEVEL : 'info',
  base: { service: 'gymflow-admin', env: process.env.NODE_ENV ?? 'development' },
});

/**
 * The id middleware stamped on this request, so a log line can be tied to the
 * exact HTTP request a member or a receptionist was making. Returns null
 * outside a request (scripts, jobs, build-time rendering).
 */
export async function requestId(): Promise<string | null> {
  try {
    return (await headers()).get(REQUEST_ID_HEADER);
  } catch {
    return null;
  }
}

/**
 * Log an event with the request id attached. Deliberately fire-and-forget:
 * resolving the request id is async, and nothing should wait on a log line.
 */
export function logWithRequest(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: LogFields = {},
): void {
  void requestId()
    .then((id) => log[level](event, { requestId: id, ...fields }))
    .catch(() => log[level](event, fields));
}
