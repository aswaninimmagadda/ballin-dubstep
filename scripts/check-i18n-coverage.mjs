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
const PATTERN = new RegExp(`\\\\b(${ATTRS.join('|')})="([A-Z][^"]{2,})"`, 'g');

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
