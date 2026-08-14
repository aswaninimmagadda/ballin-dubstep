/**
 * Indian mobile number normalization. Stored canonical form is E.164
 * (+91XXXXXXXXXX). Uniqueness is enforced per-tenant, not globally — two
 * different gyms may legitimately have the same person.
 */

export class PhoneError extends Error {}

/** Indian mobiles start 6-9 and are 10 digits. */
const IN_MOBILE_RE = /^[6-9]\d{9}$/;

export interface NormalizedPhone {
  e164: string; // +919876543210
  national: string; // 9876543210
}

export function normalizeIndianMobile(raw: string): NormalizedPhone {
  const digits = raw.replace(/[\s\-().]/g, '');
  let national: string;
  if (/^\+91\d{10}$/.test(digits)) national = digits.slice(3);
  else if (/^91\d{10}$/.test(digits)) national = digits.slice(2);
  else if (/^0\d{10}$/.test(digits)) national = digits.slice(1);
  else if (/^\d{10}$/.test(digits)) national = digits;
  else throw new PhoneError(`Not a valid Indian mobile number: "${raw}"`);
  if (!IN_MOBILE_RE.test(national)) {
    throw new PhoneError(`Not a valid Indian mobile number: "${raw}"`);
  }
  return { e164: `+91${national}`, national };
}

export function isValidIndianMobile(raw: string): boolean {
  try {
    normalizeIndianMobile(raw);
    return true;
  } catch {
    return false;
  }
}

/** Mask for display in lists/logs: +919876543210 -> 98765xxxxx */
export function maskPhone(e164: string): string {
  const national = e164.replace(/^\+91/, '');
  if (national.length !== 10) return 'xxxxxxxxxx';
  return `${national.slice(0, 5)}xxxxx`;
}

/** Build a WhatsApp deep link with a prefilled message. */
export function whatsappLink(e164: string, message: string): string {
  const num = e164.replace(/^\+/, '');
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
}
