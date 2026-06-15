import type { GeoCoord } from '@/types';

const R = 6_371_000; // Earth radius in metres

export function haversineDistance(a: GeoCoord, b: GeoCoord): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Returns bearing in degrees 0–360, North = 0, clockwise. */
export function bearingBetween(from: GeoCoord, to: GeoCoord): number {
  const φ1 = (from.lat * Math.PI) / 180;
  const φ2 = (to.lat  * Math.PI) / 180;
  const Δλ = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Converts a geographic bearing and a scene's north-heading offset into a
 * krpano-style ath value in [-180, 180].
 *
 * krpano ath=0 points to the "front" of the equirectangular image.
 * The scene's `heading` records how many degrees east of geographic north
 * that front points (i.e., the compass bearing of ath=0).
 */
export function bearingToAth(bearing: number, northHeading: number): number {
  let ath = ((bearing - northHeading + 360) % 360);
  if (ath > 180) ath -= 360;
  return ath;
}

/**
 * Computes a vertical krpano angle (atv) from a distance and height difference.
 * Positive atv = looking down, negative = looking up (krpano convention).
 * `heightDiff` = targetHeight - sourceHeight (positive means target is above).
 */
export function elevationToAtv(distanceMeters: number, heightDiffMeters: number): number {
  if (distanceMeters <= 0) return 0;
  // atv is the pitch angle; negative pitch looks up, positive looks down.
  // In krpano, atv=+90 is straight down, atv=-90 is straight up.
  return -(Math.atan2(heightDiffMeters, distanceMeters) * 180) / Math.PI;
}
