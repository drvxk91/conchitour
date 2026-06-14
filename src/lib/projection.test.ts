import { describe, it, expect } from 'vitest';
import { toPercent, fromPercent } from './projection';

describe('toPercent', () => {
  it('maps ath=0,atv=0 to center (50,50)', () => {
    expect(toPercent(0, 0)).toEqual({ x: 50, y: 50 });
  });

  it('maps ath=-180 to left edge x=0', () => {
    const { x } = toPercent(-180, 0);
    expect(x).toBeCloseTo(0, 5);
  });

  it('maps ath=+180 to right edge x=100', () => {
    const { x } = toPercent(180, 0);
    expect(x).toBeCloseTo(100, 5);
  });

  it('maps atv=-90 to top edge y=0', () => {
    const { y } = toPercent(0, -90);
    expect(y).toBeCloseTo(0, 5);
  });

  it('maps atv=+90 to bottom edge y=100', () => {
    const { y } = toPercent(0, 90);
    expect(y).toBeCloseTo(100, 5);
  });

  it('maps ath=90 to x=75', () => {
    const { x } = toPercent(90, 0);
    expect(x).toBeCloseTo(75, 5);
  });
});

describe('fromPercent', () => {
  it('maps center (50,50) to ath=0,atv=0', () => {
    const { ath, atv } = fromPercent(50, 50);
    expect(ath).toBeCloseTo(0, 5);
    expect(atv).toBeCloseTo(0, 5);
  });

  it('maps x=0 to ath=-180', () => {
    expect(fromPercent(0, 50).ath).toBeCloseTo(-180, 5);
  });

  it('maps x=100 to ath=+180', () => {
    expect(fromPercent(100, 50).ath).toBeCloseTo(180, 5);
  });

  it('maps y=0 to atv=-90', () => {
    expect(fromPercent(50, 0).atv).toBeCloseTo(-90, 5);
  });

  it('maps y=100 to atv=+90', () => {
    expect(fromPercent(50, 100).atv).toBeCloseTo(90, 5);
  });
});

describe('round-trip', () => {
  const cases: [number, number][] = [
    [0, 0], [45, 20], [-90, -45], [135, 60], [-180, 90], [180, -90],
  ];

  for (const [ath, atv] of cases) {
    it(`ath=${ath} atv=${atv} round-trips`, () => {
      const { x, y } = toPercent(ath, atv);
      const back = fromPercent(x, y);
      expect(back.ath).toBeCloseTo(ath, 5);
      expect(back.atv).toBeCloseTo(atv, 5);
    });
  }
});
