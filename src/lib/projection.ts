// Linear equirectangular projection helpers.
// x% = (ath + 180) / 360 * 100   (left edge = -180°, right = +180°)
// y% = (atv + 90)  / 180 * 100   (top = -90°, bottom = +90°)

export interface PercentCoord { x: number; y: number }
export interface SphereCoord  { ath: number; atv: number }

export function toPercent(ath: number, atv: number): PercentCoord {
  return {
    x: ((ath + 180) / 360) * 100,
    y: ((atv + 90)  / 180) * 100,
  };
}

export function fromPercent(x: number, y: number): SphereCoord {
  return {
    ath: (x / 100) * 360 - 180,
    atv: (y / 100) * 180 - 90,
  };
}
