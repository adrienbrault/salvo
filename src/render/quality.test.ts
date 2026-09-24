import { describe, expect, test } from 'bun:test';
import { DynamicResolution, pixelRatioFor, TIERS } from './quality';

describe('pixelRatioFor', () => {
  test('uses the device ratio within the tier cap on a small screen', () => {
    expect(pixelRatioFor(TIERS.ultra, 800, 600, 2)).toBe(2);
    expect(pixelRatioFor(TIERS.ultra, 800, 600, 1)).toBe(1);
    expect(pixelRatioFor(TIERS.low, 800, 600, 3)).toBe(TIERS.low.pixelRatio);
  });

  test('fits a large high-DPI screen into the pixel budget', () => {
    for (const q of Object.values(TIERS)) {
      const w = 1728;
      const h = 1117;
      const r = pixelRatioFor(q, w, h, 2);
      expect(w * r * h * r).toBeLessThanOrEqual(q.maxPixels * 1.0001);
      expect(r).toBeGreaterThanOrEqual(0.5);
    }
  });
});

describe('DynamicResolution', () => {
  test('ignores a one-off hitch', () => {
    const d = new DynamicResolution(0.6);
    const changes = [50, 50, ...Array(200).fill(8)].map((ms) => d.sample(ms));
    expect(changes.every((c) => c === null)).toBe(true);
    expect(d.scale).toBe(1);
  });

  test('steps down under sustained slow frames, never below min, and recovers', () => {
    const d = new DynamicResolution(0.6);
    for (let i = 0; i < 2000; i++) d.sample(33);
    expect(d.scale).toBeCloseTo(0.6);
    for (let i = 0; i < 20000; i++) d.sample(8);
    expect(d.scale).toBe(1);
  });
});
