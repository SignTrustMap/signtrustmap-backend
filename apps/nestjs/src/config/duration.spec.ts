import { durationMilliseconds } from './duration';

describe('durationMilliseconds', () => {
  it('returns fallback when value is undefined or empty', () => {
    expect(durationMilliseconds(undefined, 5000)).toBe(5000);
    expect(durationMilliseconds('', 5000)).toBe(5000);
  });

  it('parses numeric values with units', () => {
    expect(durationMilliseconds('500ms', 1000)).toBe(500);
    expect(durationMilliseconds('5s', 1000)).toBe(5000);
    expect(durationMilliseconds('2m', 1000)).toBe(120000);
    expect(durationMilliseconds('1h', 1000)).toBe(3600000);
    expect(durationMilliseconds('100', 1000)).toBe(100);
  });

  it('returns fallback for invalid formats or non-positive numbers', () => {
    expect(durationMilliseconds('invalid', 5000)).toBe(5000);
    expect(durationMilliseconds('-5s', 5000)).toBe(5000);
    expect(durationMilliseconds('0s', 5000)).toBe(5000);
  });
});
