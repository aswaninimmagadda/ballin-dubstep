#!/usr/bin/env node
/**
 * Fail the build when a user-visible string is hard-coded in a page component.
 *
 * The i18n parity test compares en.ts against te.ts, which is necessary and
 * not sufficient: it cannot see a string that never reached a resource file.
 * That is how 65 labels, hints, titles and placeholders stayed English through
 * a release that claimed full Telugu coverage — every one of them invisible to
 * the test that was supposed to guarantee it.
 *
 * This closes the other half: any literal in one of those attributes must come
 * from the translations.
 *
 * Usage: node scripts/check-i18n-coverage.mjs
 */
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

const ATTRS = ['label', 'hint', 'title', 'placeholder'];
// A literal starting with a capital letter and containing a space, or any
// literal of three or more characters, is prose. Single words like "id" or
// units are allowed through only when they are not capitalised.
// NOTE the single escape: this is a template literal, so `\\b` here is the
// two characters the RegExp needs for a word boundary. Written `\\\\b` it
// became a literal backslash followed by b — a pattern that matches nothing,
// so this gate silently passed everything for as long as it has existed.
const PATTERN = new RegExp(`\\b(${ATTRS.join('|')})="([A-Z][^"]{2,})"`, 'g');

/**
 * Prove the gate can fail before trusting it to pass.
 *
 * This check reported "no hard-coded strings" for its whole existence, not
 * because there were none but because one escape too many had turned its
 * pattern into something that matches no text at all. A green gate and a
 * broken gate look identical from the outside, and CI believed the wrong
 * one. So: run the pattern over a string that must match and a string that
 * must not, and refuse to report anything if either comes out wrong.
 */
const MUST_MATCH = '<Field label="Member name" />';
const MUST_NOT_MATCH = '<Field label={tr.members.name} data-x="ok" />';
if (!new RegExp(PATTERN.source).test(MUST_MATCH)) {
  console.error(
    'check-i18n-coverage is broken: its pattern no longer matches a known ' +
      'hard-coded string, so a pass here would mean nothing. Fix the pattern.',
  );
  process.exit(2);
}
if (new RegExp(PATTERN.source).test(MUST_NOT_MATCH)) {
  console.error(
    'check-i18n-coverage is broken: its pattern matches a correctly ' +
      'translated attribute, so it would fail the build on good code.',
  );
  process.exit(2);
}

const files = globSync('apps/admin/src/app/**/*.tsx', { cwd: process.cwd() });
const offenders = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(PATTERN)) {
    const line = source.slice(0, match.index).split('\n').length;
    offenders.push({ file, line, attr: match[1], text: match[2] });
  }
}

if (offenders.length) {
  console.error(
    `\n${offenders.length} hard-coded user-visible string(s). Add them to ` +
      'packages/i18n (the `ui` section) and reference them as {tr.ui.<key>}:\n',
  );
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  ${o.attr}="${o.text}"`);
  }
  console.error(
    '\nThe en/te parity test cannot catch these: a string that never reaches a\n' +
      'resource file is invisible to it.\n',
  );
  process.exit(1);
}
console.log(`i18n coverage: no hard-coded strings in ${files.length} page components.`);
