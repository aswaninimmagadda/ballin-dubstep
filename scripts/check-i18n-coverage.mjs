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

// `subtitle` joined this list after a rendered Telugu page showed five
// English sentences sitting directly under translated headings. The list
// is the gate's whole reach: anything user-visible that arrives through a
// prop not named here is invisible to it.
const ATTRS = ['label', 'hint', 'title', 'subtitle', 'placeholder'];
// A literal starting with a capital letter and containing a space, or any
// literal of three or more characters, is prose. Single words like "id" or
// units are allowed through only when they are not capitalised.
// NOTE the single escape: this is a template literal, so `\\b` here is the
// two characters the RegExp needs for a word boundary. Written `\\\\b` it
// became a literal backslash followed by b — a pattern that matches nothing,
// so this gate silently passed everything for as long as it has existed.
const PATTERN = new RegExp(`\\b(${ATTRS.join('|')})="([A-Z][^"]{2,})"`, 'g');

/**
 * The other shape a user-visible string takes here: a table's column
 * headers, passed as an array of literals rather than as an attribute.
 *
 * The attribute pattern above could never see these, and twenty-nine
 * English column headings sat across nine pages because of it — on screens
 * whose every other label was translated. A gate that only looks where it
 * is easy to look reports the coverage of its own blind spot.
 */
const HEADERS_BLOCK = /headers=\{\[([\s\S]*?)\]\}/g;
const HEADER_LITERAL = /'([A-Z][^']{1,})'|"([A-Z][^"]{1,})"/g;

const headerLiterals = (sample) =>
  [...sample.matchAll(new RegExp(HEADERS_BLOCK.source, 'g'))].flatMap((b) => [
    ...(b[1] ?? '').matchAll(new RegExp(HEADER_LITERAL.source, 'g')),
  ]);

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
const HEADERS_MUST_MATCH = "<Table headers={['Gym', 'Status']}>";
const HEADERS_MUST_NOT_MATCH = "<Table headers={[tr.ui.colGym, tr.ui.colStatus, '']}>";
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
if (headerLiterals(HEADERS_MUST_MATCH).length === 0) {
  console.error(
    'check-i18n-coverage is broken: it no longer sees a hard-coded table ' +
      'header, so a pass here would mean nothing. Fix the pattern.',
  );
  process.exit(2);
}
if (headerLiterals(HEADERS_MUST_NOT_MATCH).length > 0) {
  console.error(
    'check-i18n-coverage is broken: it flags translated table headers, so ' +
      'it would fail the build on good code.',
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
  for (const block of source.matchAll(new RegExp(HEADERS_BLOCK.source, 'g'))) {
    for (const lit of headerLiterals(block[0])) {
      const at = (block.index ?? 0) + (lit.index ?? 0);
      offenders.push({
        file,
        line: source.slice(0, at).split('\n').length,
        attr: 'table header',
        text: lit[1] ?? lit[2] ?? '',
      });
    }
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
