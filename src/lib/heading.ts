/** Normalize any degree value to [0, 360). */
export function normalizeHeading(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

// Re-export geographic helpers so callers can import everything heading-related from one place.
export { bearingBetween, bearingToAth } from './geo';
