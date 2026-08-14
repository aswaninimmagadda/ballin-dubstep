import { describe, it, expect } from 'vitest';
import {
  normalizeIndianMobile,
  isValidIndianMobile,
  maskPhone,
  whatsappLink,
  PhoneError,
} from '../src/phone';

describe('normalizeIndianMobile', () => {
  it('normalizes all common input shapes to E.164', () => {
    for (const input of [
      '9876543210',
      '09876543210',
      '919876543210',
      '+919876543210',
      '98765 43210',
      '98765-43210',
    ]) {
      expect(normalizeIndianMobile(input).e164).toBe('+919876543210');
    }
  });
  it('rejects invalid numbers', () => {
    expect(() => normalizeIndianMobile('12345')).toThrow(PhoneError);
    expect(() => normalizeIndianMobile('5876543210')).toThrow(PhoneError); // starts with 5
    expect(() => normalizeIndianMobile('+15551234567')).toThrow(PhoneError);
    expect(isValidIndianMobile('abc')).toBe(false);
  });
});

describe('maskPhone', () => {
  it('masks the last five digits', () => {
    expect(maskPhone('+919876543210')).toBe('98765xxxxx');
  });
});

describe('whatsappLink', () => {
  it('builds wa.me link with encoded message', () => {
    const link = whatsappLink('+919876543210', 'Hi Ravi, renewal due 30-Nov-2026');
    expect(link).toBe('https://wa.me/919876543210?text=Hi%20Ravi%2C%20renewal%20due%2030-Nov-2026');
  });
});
