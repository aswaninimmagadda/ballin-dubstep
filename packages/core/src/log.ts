/**
 * Structured application logging.
 *
 * One JSON object per line on stdout/stderr, which is what every log shipper
 * on the market already understands — no agent, no SDK, nothing to buy. The
 * point is that a member ringing the gym to say "it said something went
 * wrong" can be traced: the message they were shown carries a reference, the
 * reference is in a log line, and the line names the request, the gym, the
 * staff user and the route.
 *
 * Two rules make it safe to ship these lines off the box:
 *   1. Values under a sensitive key name are dropped, never printed.
 *   2. Anything that *looks* like a phone number, an email, a GSTIN or a long
 *      credential is masked wherever it appears, even under an innocent key.
 * A gym's member list is the most valuable thing in this database. Logs leave
 * the machine; member data must not leave with them.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Key names whose values never appear in a log line, at any depth. */
const SENSITIVE_KEY =
  /pass(word|hash)?|secret|token|credential|otp|authorization|cookie|session|mobile|phone|email|gstin|aadhaar|dob|address|photo|signature|hash/i;

/** Indian mobile numbers, in the shapes this product stores and accepts. */
const MOBILE = /(?:\+91[\s-]?)?[6-9]\d{9}\b/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/g;
/** Long unbroken hex/base64 runs: session tokens, hashes, keys. */
const CREDENTIALish = /\b[A-Fa-f0-9]{32,}\b|\b[A-Za-z0-9_-]{40,}\b/g;

const MAX_STRING = 300;
const MAX_DEPTH = 4;

/** Mask anything that reads as personal or secret, wherever it turns up. */
export function scrubText(value: string): string {
  const masked = value
    .replace(EMAIL, '[email]')
    .replace(GSTIN, '[gstin]')
    .replace(MOBILE, '[mobile]')
    .replace(CREDENTIALish, '[redacted]');
  return masked.length > MAX_STRING ? `${masked.slice(0, MAX_STRING)}…` : masked;
}

function scrubValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: scrubText(value.message) };
  }
  if (depth >= MAX_DEPTH) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrubValue(v, depth + 1));
  if (typeof value === 'object') return scrubFields(value as LogFields, depth + 1);
  return String(value);
}

function scrubFields(fields: LogFields, depth = 0): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key)) {
      // Keep the key so the shape of the line is stable and greppable; drop
      // the value. `null`/`undefined` stay as they are — "absent" is not
      // sensitive and is often the thing being diagnosed.
      out[key] = value === null || value === undefined ? value : '[redacted]';
      continue;
    }
    out[key] = scrubValue(value, depth);
  }
  return out;
}

export interface LogRecord extends LogFields {
  level: LogLevel;
  time: string;
  event: string;
}

/** Build one log line. Exported so it can be tested without a sink. */
export function formatLogLine(
  level: LogLevel,
  event: string,
  fields: LogFields,
  now: Date,
): string {
  const record: LogRecord = {
    level,
    time: now.toISOString(),
    event,
    ...scrubFields(fields),
  };
  // An error is what an on-call alert fires on; make it a single greppable
  // token rather than something a rule has to reconstruct from the level.
  if (level === 'error') record.alert = true;
  try {
    return JSON.stringify(record);
  } catch {
    // A circular or otherwise unserialisable field must not cost us the line.
    return JSON.stringify({ level, time: record.time, event, unserialisable: true });
  }
}

export interface LoggerOptions {
  minLevel?: LogLevel;
  /** Fields merged into every line — service name, environment, version. */
  base?: LogFields;
  write?: (line: string, level: LogLevel) => void;
  now?: () => Date;
}

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

const defaultWrite = (line: string, level: LogLevel): void => {
  if (level === 'error') console.error(line);
  else console.log(line);
};

export function createLogger(options: LoggerOptions = {}): Logger {
  const min = LEVEL_ORDER[options.minLevel ?? 'info'];
  const write = options.write ?? defaultWrite;
  const now = options.now ?? (() => new Date());
  const base = options.base ?? {};

  const emit = (level: LogLevel, event: string, fields?: LogFields): void => {
    if (LEVEL_ORDER[level] < min) return;
    try {
      write(formatLogLine(level, event, { ...base, ...fields }, now()), level);
    } catch {
      // Logging must never be the reason a request fails.
    }
  };

  return {
    debug: (e, f) => emit('debug', e, f),
    info: (e, f) => emit('info', e, f),
    warn: (e, f) => emit('warn', e, f),
    error: (e, f) => emit('error', e, f),
    child: (fields) => createLogger({ ...options, base: { ...base, ...fields } }),
  };
}

export function isLogLevel(value: string | undefined): value is LogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}
