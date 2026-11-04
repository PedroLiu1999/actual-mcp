import { describe, expect, it } from 'vitest';
import { decimalToMinorAmount, minorToDecimalAmount } from '../src/currency.js';

describe('currency conversion helpers', () => {
  it('converts Decimal Amounts to integer Minor Unit Amounts without floating-point drift', () => {
    expect(decimalToMinorAmount(0)).toBe(0);
    expect(decimalToMinorAmount(-12.34)).toBe(-1234);
    expect(decimalToMinorAmount(100.0)).toBe(10000);
    // Classic IEEE 754 drift cases: 19.99 * 100 === 1998.9999999999998, 1.005 * 100 === 100.49999999999999
    expect(decimalToMinorAmount(19.99)).toBe(1999);
    expect(decimalToMinorAmount(-19.99)).toBe(-1999);
    expect(decimalToMinorAmount(1.15)).toBe(115);
    expect(decimalToMinorAmount(-54.9)).toBe(-5490);
  });

  it('converts integer Minor Unit Amounts to Decimal Amounts accurately', () => {
    expect(minorToDecimalAmount(0)).toBe(0);
    expect(minorToDecimalAmount(-1234)).toBe(-12.34);
    expect(minorToDecimalAmount(10000)).toBe(100);
    expect(minorToDecimalAmount(1999)).toBe(19.99);
    expect(minorToDecimalAmount(-5490)).toBe(-54.9);
  });
});
