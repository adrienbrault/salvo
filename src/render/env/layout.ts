import type {
  Color,
  Group,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three/webgpu';
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
  /** The breakable it stands on (and which of its parts): once that is broken the prop rides the fall. */
  owner?: Breakable;
  part?: number;
  /** Rest pose (segment-local), and its orientation when the owner broke. */
  rest: Vector3;
  restQ: Quaternion;
}

export interface Lamp {
  x: number;
  y: number;
  z: number;
  color: Color;
  intensity: number;
  distance: number;
  /** The breakable it belongs to: once that is broken the lamp is out. */
  owner?: Breakable;
}

/** How a broken structure comes down. */
export type Fall = 'topple' | 'slump' | 'sink' | 'hinge';

/**
 * One rigid part of a breakable. Its vertices (hull, beacons, light cones) carry `aPart` =
 * `index`, and the materials pose them from that row of the part table (see PartTable).
 */
export interface BreakPart {
  index: number;
  /** Segment-local point it falls about. */
  pivot: Vector3;
  axis: Vector3;
  angle: number;
  sink: number;
  duration: number;
  /** Centre of the part relative to the pivot (where its fire burns). */
  center: Vector3;
  /** Current pose: rotation about the pivot, then a drop along −z. */
  q: Quaternion;
  drop: number;
}

/**
 * A structure that explosions can bring down: parts of the segment's own meshes (no extra
 * draw calls) that the vertex shader rotates about their pivots once broken.
 */
export interface Breakable {
  /** Segment-local footprint and top, used for hit tests. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  zTop: number;
  /** Rough size, for effects. */
  size: number;
  hp: number;
  maxHp: number;
  explosive: boolean;
  parts: BreakPart[];
  /** Trench clock when it broke; −1 while intact. */
  brokenAt: number;
}

export interface Segment {
  group: Group;
  props: Prop[];
  lamps: Lamp[];
  breakables: Breakable[];
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
