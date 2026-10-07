// Turns raw Face Landmarker output into numbers the game cares about.

import type { Category, Matrix } from '@mediapipe/tasks-vision';
import { Euler, MathUtils, Matrix4 } from 'three';

/**
 * Head rotation in degrees, straight from MediaPipe's camera-space matrix.
 * Which sign means "left" / "up" gets pinned down on a real device when the
 * Face ID–style guide ring is built (Phase 1).
 */
export interface HeadPose {
  /** Turn left/right. */
  yaw: number;
  /** Nod up/down. */
  pitch: number;
  /** Tilt towards a shoulder. */
  roll: number;
  /** Rough distance from camera in centimetres. */
  distanceCm: number;
}

const matrix = new Matrix4();
const euler = new Euler();

export function headPoseFromMatrix(m: Matrix): HeadPose {
  matrix.fromArray(m.data);
  euler.setFromRotationMatrix(matrix, 'YXZ');
  return {
    yaw: MathUtils.radToDeg(euler.y),
    pitch: MathUtils.radToDeg(euler.x),
    roll: MathUtils.radToDeg(euler.z),
    distanceCm: Math.abs(m.data[14]),
  };
}

export type Blendshapes = Record<string, number>;

export function blendshapeMap(categories: Category[]): Blendshapes {
  const map: Blendshapes = {};
  for (const c of categories) map[c.categoryName] = c.score;
  return map;
}

/** Blendshapes that should stay low while the player holds a relaxed, neutral face. */
const NEUTRAL_LIMITS: Record<string, number> = {
  mouthSmileLeft: 0.35,
  mouthSmileRight: 0.35,
  jawOpen: 0.25,
  mouthFrownLeft: 0.4,
  mouthFrownRight: 0.4,
  browDownLeft: 0.45,
  browDownRight: 0.45,
  browInnerUp: 0.45,
  eyeWideLeft: 0.45,
  eyeWideRight: 0.45,
  mouthPucker: 0.5,
  cheekPuff: 0.4,
  noseSneerLeft: 0.4,
  noseSneerRight: 0.4,
};

export interface NeutralCheck {
  neutral: boolean;
  /** Blendshapes currently over their limit, strongest first. */
  offenders: string[];
}

export function checkNeutral(shapes: Blendshapes): NeutralCheck {
  const offenders = Object.entries(NEUTRAL_LIMITS)
    .filter(([name, limit]) => (shapes[name] ?? 0) > limit)
    .sort(([a], [b]) => (shapes[b] ?? 0) - (shapes[a] ?? 0))
    .map(([name]) => name);
  return { neutral: offenders.length === 0, offenders };
}
