import { describe, it, expect } from 'vitest';
import { csvEscape, toCsv } from '../src/csv';

describe('csvEscape', () => {
  it('neutralizes every character that starts a formula', () => {
    expect(csvEscape('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvEscape('@import')).toBe("'@import");
    expect(csvEscape('\tTAB')).toBe("'\tTAB");
    expect(csvEscape('\rCR')).toBe('"\'\rCR"');
    expect(csvEscape('+cmd|/c calc')).toBe("'+cmd|/c calc");
    expect(csvEscape('-2+3+cmd')).toBe("'-2+3+cmd");
  });

  it('leaves phone numbers and negative amounts alone', () => {
    // The whole point: a blanket rule on + and - mangled every mobile number
    // and every negative amount in every export the gym sends its accountant.
    expect(csvEscape('+919876543210')).toBe('+919876543210');
    expect(csvEscape('-500')).toBe('-500');
    expect(csvEscape('-1,200.50')).toBe('"-1,200.50"');
    expect(csvEscape('+91 (0884) 234567')).toBe('+91 (0884) 234567');
  });

  it('quotes and doubles quotes where CSV requires it', () => {
    expect(csvEscape('Ravi Kumar')).toBe('Ravi Kumar');
    expect(csvEscape('Kumar, Ravi')).toBe('"Kumar, Ravi"');
    expect(csvEscape('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  it('renders null and undefined as empty, not as the words', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
    expect(csvEscape(0)).toBe('0');
  });
});

describe('toCsv', () => {
  it('takes the header order from the first row', () => {
    expect(toCsv([{ b: 2, a: 1 }])).toBe('b,a\n2,1');
  });

  it('returns an empty document for no rows', () => {
    expect(toCsv([])).toBe('');
  });

  it('escapes every cell', () => {
    expect(toCsv([{ name: '=BAD()', mobile: '+919876543210' }])).toBe(
      "name,mobile\n'=BAD(),+919876543210",
    );
  });
});
