import { describe, it, expect } from 'vitest';
import { createMemberSchema } from '../src/member.js';
import { sellMembershipSchema } from '../src/membership.js';
import { recordPaymentSchema } from '../src/payment.js';
import { importMemberRowSchema } from '../src/import.js';
import { staffLoginSchema, memberLoginSchema } from '../src/auth.js';

const UUID = '2b0a3c1e-0000-4000-8000-000000000001';

describe('createMemberSchema', () => {
  it('normalizes mobile to E.164', () => {
    const r = createMemberSchema.parse({
      branchId: UUID,
      firstName: 'Ravi',
      mobile: '98765 43210',
    });
    expect(r.mobile).toBe('+919876543210');
    expect(r.tags).toEqual([]);
  });
  it('rejects invalid mobile', () => {
    expect(() =>
      createMemberSchema.parse({ branchId: UUID, firstName: 'X', mobile: '12345' }),
    ).toThrow();
  });
  it('rejects invalid PIN code', () => {
    expect(() =>
      createMemberSchema.parse({
        branchId: UUID,
        firstName: 'X',
        mobile: '9876543210',
        pinCode: '0123',
      }),
    ).toThrow();
  });
});

describe('sellMembershipSchema', () => {
  it('requires an idempotency key', () => {
    expect(() =>
      sellMembershipSchema.parse({
        memberId: UUID,
        planId: UUID,
        startDate: '2026-06-01',
      }),
    ).toThrow();
  });
  it('accepts a full sale with payment', () => {
    const r = sellMembershipSchema.parse({
      memberId: UUID,
      planId: UUID,
      startDate: '2026-06-01',
      idempotencyKey: 'sale-abc-123',
      payment: { amount: 300000, method: 'cash' },
    });
    expect(r.includeJoiningFee).toBe(true);
  });
});

describe('recordPaymentSchema', () => {
  it('rejects zero and float amounts', () => {
    const base = { memberId: UUID, method: 'cash', idempotencyKey: 'pay-12345678' };
    expect(() => recordPaymentSchema.parse({ ...base, amount: 0 })).toThrow();
    expect(() => recordPaymentSchema.parse({ ...base, amount: 100.5 })).toThrow();
    expect(recordPaymentSchema.parse({ ...base, amount: 100 }).amount).toBe(100);
  });
});

describe('importMemberRowSchema', () => {
  it('accepts a typical notebook row', () => {
    const r = importMemberRowSchema.parse({
      member_name: 'Lakshmi Devi',
      mobile: '9123456789',
      membership_plan: '3 Month',
      start_date: '2026-05-01',
      expiry_date: '2026-07-31',
      amount_paid: '3000',
      payment_method: 'cash',
      trainer: '',
      notes: '',
    });
    expect(r.mobile).toBe('+919123456789');
  });
  it('rejects a bad date', () => {
    expect(() =>
      importMemberRowSchema.parse({
        member_name: 'X',
        mobile: '9123456789',
        membership_plan: 'Y',
        start_date: '2026-02-30',
      }),
    ).toThrow();
  });
});

describe('auth schemas', () => {
  it('lowercases staff email', () => {
    expect(staffLoginSchema.parse({ email: 'Owner@Gym.IN', password: 'password123' }).email).toBe(
      'owner@gym.in',
    );
  });
  it('member login is tenant scoped', () => {
    const r = memberLoginSchema.parse({
      gymCode: 'AP-FITNESS',
      mobile: '9876543210',
      password: 'secret1',
    });
    expect(r.gymCode).toBe('ap-fitness');
  });
});
