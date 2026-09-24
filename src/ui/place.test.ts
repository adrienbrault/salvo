import { describe, expect, test } from 'bun:test';
import { ABOVE, BESIDE, placeBeside, type Rect } from './place';

const view = { w: 1000, h: 800 };
const box = { w: 300, h: 200 };
const rect = (left: number, top: number, w: number, h: number): Rect => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

describe('placeBeside', () => {
  test('goes right of the anchor, centred on it, when there is room', () => {
    expect(placeBeside(rect(100, 300, 140, 200), box, view, BESIDE)).toEqual({
      x: 250,
      y: 300,
      side: 'right',
    });
  });

  test('flips left when the right edge is too close', () => {
    expect(placeBeside(rect(800, 300, 140, 200), box, view, BESIDE)).toEqual({
      x: 490,
      y: 300,
      side: 'left',
    });
  });

  test('clamps the cross axis inside the viewport', () => {
    expect(placeBeside(rect(100, 0, 140, 60), box, view, BESIDE)).toEqual({ x: 250, y: 8, side: 'right' });
    expect(placeBeside(rect(100, 760, 140, 40), box, view, BESIDE).y).toBe(592);
  });

  test('goes above small tiles, below when the top is too close', () => {
    expect(placeBeside(rect(450, 600, 80, 80), box, view, ABOVE)).toEqual({ x: 340, y: 390, side: 'top' });
    expect(placeBeside(rect(450, 100, 80, 80), box, view, ABOVE)).toEqual({ x: 340, y: 190, side: 'bottom' });
    expect(placeBeside(rect(0, 600, 80, 80), box, view, ABOVE).x).toBe(8);
  });

  test('takes the roomiest side and stays on screen when nothing fits', () => {
    const narrow = { w: 400, h: 300 };
    // No side has room; below is the least short (138 px), and the box is pushed back on screen.
    expect(placeBeside(rect(20, 20, 300, 200), box, narrow, BESIDE)).toEqual({
      x: 20,
      y: 92,
      side: 'bottom',
    });
  });
});
