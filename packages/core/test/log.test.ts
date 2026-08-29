import { describe, it, expect } from 'vitest';
import { createLogger, formatLogLine, scrubText } from '../src/log';

const AT = new Date('2026-08-29T06:30:00.000Z');
const parse = (line: string | undefined) => JSON.parse(line ?? '{}') as Record<string, unknown>;

describe('log line shape', () => {
  it('is one JSON object with level, time and event', () => {
    const rec = parse(formatLogLine('info', 'member.login', { tenantId: 't1' }, AT));
    expect(rec).toMatchObject({
      level: 'info',
      time: '2026-08-29T06:30:00.000Z',
      event: 'member.login',
      tenantId: 't1',
    });
  });

  it('marks errors for alerting', () => {
    expect(parse(formatLogLine('error', 'x', {}, AT)).alert).toBe(true);
    expect(parse(formatLogLine('warn', 'x', {}, AT)).alert).toBeUndefined();
  });

  it('survives a circular field rather than losing the line', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const rec = parse(formatLogLine('error', 'boom', { circular }, AT));
    expect(rec.event).toBe('boom');
  });
});

describe('nothing personal reaches the log', () => {
  it('drops values under a sensitive key but keeps the key', () => {
    const rec = parse(
      formatLogLine(
        'info',
        'x',
        { mobile: '+919876543210', email: 'a@b.com', password: 'hunter2', memberId: 'm1' },
        AT,
      ),
    );
    expect(rec.mobile).toBe('[redacted]');
    expect(rec.email).toBe('[redacted]');
    expect(rec.password).toBe('[redacted]');
    expect(rec.memberId).toBe('m1');
  });

  it('masks a phone number that turns up under an innocent key', () => {
    const rec = parse(formatLogLine('info', 'x', { note: 'called 9876543210 twice' }, AT));
    expect(rec.note).toBe('called [mobile] twice');
  });

  it('masks +91 numbers, emails and GSTINs in free text', () => {
    expect(scrubText('ring +91 9876543210')).toBe('ring [mobile]');
    expect(scrubText('mail ravi.k+gym@example.co.in')).toBe('mail [email]');
    expect(scrubText('gst 37ABCDE1234F1Z5 ok')).toBe('gst [gstin] ok');
  });

  it('masks anything long enough to be a token or a hash', () => {
    expect(scrubText(`token ${'a'.repeat(64)}`)).toBe('token [redacted]');
  });

  it('reaches into nested objects and arrays', () => {
    const rec = parse(
      formatLogLine('info', 'x', { input: { rows: [{ note: 'call 9876543210' }] } }, AT),
    );
    expect(JSON.stringify(rec)).toContain('[mobile]');
    expect(JSON.stringify(rec)).not.toContain('9876543210');
  });

  it('keeps null under a sensitive key — absence is not a secret', () => {
    const rec = parse(formatLogLine('info', 'x', { email: null }, AT));
    expect(rec.email).toBeNull();
  });

  it('truncates a long string instead of writing a wall of text', () => {
    const rec = parse(formatLogLine('info', 'x', { note: 'y'.repeat(1000) }, AT));
    expect(String(rec.note).length).toBeLessThan(320);
  });

  it('records an Error as name and message, never a stack of paths', () => {
    const rec = parse(formatLogLine('error', 'x', { err: new Error('failed for 9876543210') }, AT));
    expect(rec.err).toEqual({ name: 'Error', message: 'failed for [mobile]' });
  });
});

describe('logger', () => {
  it('honours the minimum level', () => {
    const lines: string[] = [];
    const log = createLogger({ minLevel: 'warn', write: (l) => lines.push(l), now: () => AT });
    log.info('quiet');
    log.warn('loud');
    expect(lines).toHaveLength(1);
    expect(parse(lines[0]).event).toBe('loud');
  });

  it('merges base fields and child fields into every line', () => {
    const lines: string[] = [];
    const log = createLogger({
      base: { service: 'admin' },
      write: (l) => lines.push(l),
      now: () => AT,
    }).child({ requestId: 'r1' });
    log.info('hit', { route: '/members' });
    expect(parse(lines[0])).toMatchObject({ service: 'admin', requestId: 'r1', route: '/members' });
  });

  it('never throws out of a log call', () => {
    const log = createLogger({
      write: () => {
        throw new Error('sink is gone');
      },
    });
    expect(() => log.error('boom')).not.toThrow();
  });
});
