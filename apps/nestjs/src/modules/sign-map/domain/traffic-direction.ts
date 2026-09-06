export function appliesToTrafficHeading(
  trafficDirectionDegrees: number | null,
  routeHeadingDegrees: number,
  toleranceDegrees: number,
): boolean {
  if (trafficDirectionDegrees == null) return true;
  return angularDifference(routeHeadingDegrees, trafficDirectionDegrees) <= toleranceDegrees;
}

function angularDifference(first: number, second: number): number {
  const difference = Math.abs(normalizeHeading(first) - normalizeHeading(second));
  return Math.min(difference, 360 - difference);
}

function normalizeHeading(heading: number): number {
  return ((heading % 360) + 360) % 360;
}
