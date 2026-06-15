import { describe, it, expect } from 'vitest';
import { haversineDistance, bearingBetween, bearingToAth, elevationToAtv } from './geo';

describe('haversineDistance', () => {
  it('returns 0 for the same point', () => {
    expect(haversineDistance({ lat: 48.8566, lng: 2.3522 }, { lat: 48.8566, lng: 2.3522 })).toBe(0);
  });

  it('returns ~111km for 1 degree of latitude', () => {
    const d = haversineDistance({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeCloseTo(111_195, -2);
  });

  it('computes ~10m for a short move', () => {
    // ~9e-5 degrees latitude ≈ 10 metres
    const d = haversineDistance({ lat: 0, lng: 0 }, { lat: 0.00009, lng: 0 });
    expect(d).toBeGreaterThan(5);
    expect(d).toBeLessThan(15);
  });
});

describe('bearingBetween', () => {
  it('returns 0 (North) when moving straight north', () => {
    const b = bearingBetween({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(b).toBeCloseTo(0, 2);
  });

  it('returns 90 (East) when moving straight east', () => {
    const b = bearingBetween({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    expect(b).toBeCloseTo(90, 0);
  });

  it('returns 180 (South) when moving straight south', () => {
    const b = bearingBetween({ lat: 1, lng: 0 }, { lat: 0, lng: 0 });
    expect(b).toBeCloseTo(180, 2);
  });

  it('returns 270 (West) when moving straight west', () => {
    const b = bearingBetween({ lat: 0, lng: 1 }, { lat: 0, lng: 0 });
    expect(b).toBeCloseTo(270, 0);
  });
});

describe('bearingToAth', () => {
  it('returns 0 when bearing equals northHeading (scene front points at target)', () => {
    expect(bearingToAth(90, 90)).toBe(0);
  });

  it('returns 90 when target is 90° clockwise from scene front', () => {
    expect(bearingToAth(180, 90)).toBe(90);
  });

  it('wraps correctly into [-180, 180]', () => {
    // bearing 10°, scene front at 200° → 10-200=-190° → normalised to +170° (shorter clockwise path)
    const ath = bearingToAth(10, 200);
    expect(ath).toBeCloseTo(170, 1);
  });
});

describe('elevationToAtv', () => {
  it('returns 0 when distance is 0', () => {
    expect(elevationToAtv(0, 5)).toBe(0);
  });

  it('returns 0 for level targets', () => {
    expect(elevationToAtv(100, 0)).toBeCloseTo(0, 5);
  });

  it('returns negative (upward) atv for a higher target', () => {
    // target is 10m above, 10m away → ~45° up → atv ≈ -45
    expect(elevationToAtv(10, 10)).toBeCloseTo(-45, 0);
  });

  it('returns positive (downward) atv for a lower target', () => {
    expect(elevationToAtv(10, -10)).toBeCloseTo(45, 0);
  });
});
