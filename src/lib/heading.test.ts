import { describe, it, expect } from 'vitest';
import { normalizeHeading } from './heading';

describe('normalizeHeading', () => {
  it('returns 0 for 0', () => expect(normalizeHeading(0)).toBe(0));
  it('returns 0 for 360', () => expect(normalizeHeading(360)).toBe(0));
  it('returns 10 for 370', () => expect(normalizeHeading(370)).toBe(10));
  it('returns 350 for -10', () => expect(normalizeHeading(-10)).toBe(350));
  it('returns 0.5 for 720.5', () => expect(normalizeHeading(720.5)).toBeCloseTo(0.5));
  it('returns 180 for 180', () => expect(normalizeHeading(180)).toBe(180));
  it('handles large negative values', () => expect(normalizeHeading(-370)).toBe(350));
});
