/** Normalize any degree value to [0, 360). */
export function normalizeHeading(deg: number): number {
  return ((deg % 360) + 360) % 360;
}
