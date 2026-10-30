import { Transform } from 'class-transformer';

/**
 * Safely parses an input value into a finite number.
 *
 * Standard `class-transformer`'s `@Type(() => Number)` coerces `false` to `0`, `true` to `1`,
 * and `""` to `0`, which can turn invalid boolean/empty payloads into valid coordinates (e.g. 0.0)
 * that bypass validation and trigger 502/400 errors downstream in routing engines.
 *
 * This transformer returns `NaN` for booleans, empty strings, null, and non-primitives,
 * causing `class-validator`'s `@IsNumber()` or `@IsInt()` to reject the value with HTTP 400.
 */
export function toFiniteNumber(value: unknown): unknown {
  if (
    typeof value === 'boolean' ||
    value === '' ||
    value === null ||
    value === undefined ||
    typeof value === 'object'
  ) {
    return NaN;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

export const ToNumber = () =>
  Transform(({ value }) => {
    if (value === undefined) return undefined;
    return toFiniteNumber(value);
  });
