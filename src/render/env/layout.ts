import type { Color, Group, MeshBasicNodeMaterial, MeshStandardNodeMaterial, Object3D } from 'three/webgpu';
import { FLOOR_Z } from '../palette';

/** Cross-section of the trench, for the +x side (mirrored for −x). World units. */
export const TRENCH = {
  hullZ: -6,
  lipX: 46,
  lipW: 3,
  lipH: 1.2,
  terraceZ: -18,
  terraceOut: 42,
  terraceIn: 35,
  bedX: 31,
  bedZ: FLOOR_Z - 5,
  deckX: 240,
  railX: 38.4,
} as const;

/** Length of one scrolling segment (world units along y). */
export const SEG = 64;

/** Beacon kinds (see beacon material). */
export const B_RED = 0;
export const B_ACCENT = 1;
export const B_STROBE = 2;
export const B_LAMP = 3;
export const B_FLOW = 4;

export interface Prop {
  obj: Object3D;
  /** 'spin' turns at `speed` rad/s; 'turret' tracks the player. */
  kind: 'spin' | 'turret';
  x: number;
  y: number;
  speed: number;
  angle: number;
}

export interface Lamp {
  x: number;
  y: number;
  z: number;
  color: Color;
  intensity: number;
  distance: number;
}

export interface Segment {
  group: Group;
  props: Prop[];
  lamps: Lamp[];
}

export interface Materials {
  hull: MeshStandardNodeMaterial;
  beacon: MeshBasicNodeMaterial;
  cone: MeshBasicNodeMaterial;
  shadows: boolean;
}

/** Features that must line up across segments (so they are fixed per trench, not per segment). */
export interface SideConfig {
  pipes: { z: number; r: number }[];
  /** Deck conduits running along the trench in the gaps between structure columns. */
  conduits: { side: 1 | -1; x: number; kind: 'pipes' | 'channel' | 'rail' }[];
}
