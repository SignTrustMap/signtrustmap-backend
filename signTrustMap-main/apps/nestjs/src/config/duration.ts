export function durationMilliseconds(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const match = value.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i);
  if (!match) return fallback;

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
  };
  const milliseconds = Number(match[1]) * multipliers[(match[2] ?? 'ms').toLowerCase()];
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : fallback;
}
