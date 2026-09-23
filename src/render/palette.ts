import { Color } from 'three/webgpu';
import type { Hue } from '../sim/types';

/** sRGB hex per palette slot. Colors are converted to linear working space by three. */
export const HUE_HEX: Record<Hue, number> = {
  pink: 0xff3d8b,
  orange: 0xff8a1f,
  cyan: 0x28e7ff,
  lime: 0x9dff3d,
  violet: 0x9b5cff,
  gold: 0xffc93d,
  white: 0xf2f4ff,
  red: 0xff2a3a,
  blue: 0x3d7bff,
};

const cache = new Map<Hue, Color>();

/** Linear-space color for a hue (shared instance — do not mutate). */
export function hueColor(h: Hue): Color {
  let c = cache.get(h);
  if (!c) {
    c = new Color(HUE_HEX[h]);
    cache.set(h, c);
  }
  return c;
}

/** Height of the gameplay plane above which nothing is simulated (render-only depth). */
export const PLAY_Z = 0;
/** The liquid-metal sea below the battle. */
export const FLOOR_Z = -26;
/** World units per second the environment scrolls toward the bottom of the screen. */
export const SCROLL_SPEED = 16;
