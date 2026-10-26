import { toFiniteNumber } from './to-number.transformer';

describe('toFiniteNumber', () => {
  it('preserves valid numbers', () => {
    expect(toFiniteNumber(10.7949)).toBe(10.7949);
    expect(toFiniteNumber(0)).toBe(0);
    expect(toFiniteNumber(-90)).toBe(-90);
    expect(toFiniteNumber(180)).toBe(180);
  });

  it('converts numeric strings to numbers', () => {
    expect(toFiniteNumber('10.7949')).toBe(10.7949);
    expect(toFiniteNumber('0')).toBe(0);
    expect(toFiniteNumber('-45.5')).toBe(-45.5);
  });

  it('rejects booleans to prevent false becoming 0', () => {
    expect(Number.isNaN(toFiniteNumber(false))).toBe(true);
    expect(Number.isNaN(toFiniteNumber(true))).toBe(true);
  });

  it('rejects empty strings, null, and non-primitives', () => {
    expect(Number.isNaN(toFiniteNumber(''))).toBe(true);
    expect(Number.isNaN(toFiniteNumber(null))).toBe(true);
    expect(Number.isNaN(toFiniteNumber(undefined))).toBe(true);
    expect(Number.isNaN(toFiniteNumber({}))).toBe(true);
    expect(Number.isNaN(toFiniteNumber([]))).toBe(true);
    expect(Number.isNaN(toFiniteNumber('abc'))).toBe(true);
  });
});
