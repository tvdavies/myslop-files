// World layout: where every trail step sits on the mountain, and the terrain
// height function the mountain mesh is built from. Trails run up the front
// face; their summits trace the ridge line, so column 7 is the peak.

import { COLUMN_HEIGHT, COLUMNS } from "../engine/rules";

export const COL_SPACING = 1.6;
export const STEP_RISE = 0.66;
export const STEP_DEPTH = 0.62;
export const SLOPE = STEP_RISE / STEP_DEPTH;
const BACK_SLOPE = 0.85;
/** World z of each trailhead (step 0). Trails climb towards -z. */
export const Z0 = 5;

export const colX = (column: number) => (column - 7) * COL_SPACING;

const summitY = (column: number) => COLUMN_HEIGHT[column]! * STEP_RISE;

function ridge(x: number): number {
  const xs = COLUMNS.map(colX);
  const first = xs[0]!;
  const last = xs[xs.length - 1]!;
  const lift = 0.9;
  if (x <= first) return Math.max(0, summitY(2) + lift - (first - x) * 1.1);
  if (x >= last) return Math.max(0, summitY(12) + lift - (x - last) * 1.1);
  const i = Math.min(COLUMNS.length - 2, Math.floor((x - first) / COL_SPACING));
  const t = (x - xs[i]!) / COL_SPACING;
  const a = summitY(COLUMNS[i]!);
  const b = summitY(COLUMNS[i + 1]!);
  // Sag between trails so every summit reads as its own little peak.
  return a + (b - a) * t + lift - Math.sin(Math.PI * t) * 0.55;
}

// Cheap deterministic value noise; good enough for low-poly crags.
function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function terrainHeight(x: number, z: number): number {
  const u = Z0 - z; // distance up the slope
  const r = ridge(x);
  const front = u * SLOPE;
  const ridgeU = r / SLOPE;
  const back = r - (u - ridgeU) * BACK_SLOPE;
  let h = Math.max(0, Math.min(front, back));

  // Quieten noise along trail lines so stepping stones sit on a clean path.
  const nearest = Math.min(...COLUMNS.map((c) => Math.abs(x - colX(c))));
  const onTrail = u > -0.3 && u < ridgeU + 0.2 && nearest < 0.45;
  const amp = onTrail ? 0.04 : 0.28 + Math.min(h, 6) * 0.04;
  h += (noise(x * 0.9, z * 0.9) - 0.5) * 2 * amp + (noise(x * 2.3 + 9, z * 2.3) - 0.5) * amp * 0.6;

  // Rolling foothills out front and around the sides.
  if (u < 0 || h < 0.4) h = Math.max(h, (noise(x * 0.35, z * 0.35) - 0.35) * 0.9);
  return h;
}

export interface StepPoint {
  x: number;
  y: number;
  z: number;
}

export function stepPoint(column: number, step: number): StepPoint {
  const x = colX(column);
  const z = Z0 - step * STEP_DEPTH - (step === 0 ? -0.7 : 0);
  return { x, y: terrainHeight(x, z) + 0.06, z };
}
