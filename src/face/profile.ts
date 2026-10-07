// Turns the frames captured during face creation into the player's face profile:
// a 3D face shape, a face texture, skin & hair colour, and personal expressions.

import { VERTEX_COUNT } from './canonicalFace';
import {
  alignToCanonical,
  applySimilarity,
  headAngles,
  type Points,
  solveSimilarity,
  STABLE_POINTS,
  toObservedPoints,
  vertexNormals,
} from './geometry';
import { bakeFaceTexture, medianColor, type RGB, type TextureView } from './texture';

export const EXPRESSIONS = ['smile', 'laugh', 'surprised', 'angry', 'sad'] as const;
export type ExpressionName = (typeof EXPRESSIONS)[number];

export const PROFILE_VERSION = 1;

export interface FaceProfile {
  version: typeof PROFILE_VERSION;
  createdAt: number;
  /** VERTEX_COUNT × xyz in canonical space (cm). */
  shape: Float32Array;
  /** JPEG face texture in the canonical UV layout. */
  texture: Blob;
  skinTone: RGB;
  hairColor: RGB;
  /** Per-vertex offsets from the neutral shape (cm), one set per captured expression. */
  expressions: Partial<Record<ExpressionName, Float32Array>>;
}

export interface CapturedFrame {
  /** Packed normalised landmarks (x, y, z × 478). */
  landmarks: Float32Array;
  width: number;
  height: number;
  /** The camera frame itself — only kept for frames used to build the texture. */
  image?: HTMLCanvasElement;
}

export interface CaptureSession {
  /** Neutral-face frames: straight-on first, then the head-turn angles. */
  neutral: CapturedFrame[];
  expressions: Partial<Record<ExpressionName, CapturedFrame>>;
}

const DEFAULT_HAIR: RGB = [46, 33, 27];

export async function buildProfile(session: CaptureSession): Promise<FaceProfile> {
  if (!session.neutral.length) throw new Error('No face frames were captured.');

  const shape = averageShape(session.neutral);

  const views: TextureView[] = [];
  for (const frame of session.neutral) {
    if (!frame.image) continue;
    const { yaw, pitch } = headAngles(alignToCanonical(toObservedPoints(frame.landmarks, frame.width, frame.height)).transform);
    // Prefer the straight-on view; side views mostly fill in the cheeks and jaw.
    const straight = Math.abs(yaw) < 10 && Math.abs(pitch) < 10;
    views.push({ image: frame.image, landmarks: frame.landmarks, weight: straight ? 3 : 1 });
  }
  if (!views.length) throw new Error('No face photos were captured.');

  // Let the "Building…" screen paint before the heavy work starts.
  await new Promise((resolve) => setTimeout(resolve, 30));
  const { canvas, skinTone } = bakeFaceTexture(views);
  const texture = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the face texture.'))), 'image/jpeg', 0.9),
  );

  const expressions: FaceProfile['expressions'] = {};
  for (const [name, frame] of Object.entries(session.expressions) as [ExpressionName, CapturedFrame][]) {
    expressions[name] = expressionOffsets(frame, shape);
  }

  const front = session.neutral.find((f) => f.image) ?? session.neutral[0];
  return {
    version: PROFILE_VERSION,
    createdAt: Date.now(),
    shape,
    texture,
    skinTone,
    hairColor: front.image ? sampleHairColor(front, skinTone) : DEFAULT_HAIR,
    expressions,
  };
}

/**
 * Average all neutral frames in canonical space. Each vertex is trusted in
 * proportion to how directly it faced the camera in that frame, so side views
 * refine the nose and jaw without blurring the parts they saw edge-on.
 */
export function averageShape(frames: CapturedFrame[]): Points {
  const sum = new Float64Array(VERTEX_COUNT * 3);
  const weights = new Float64Array(VERTEX_COUNT);
  for (const frame of frames) {
    const observed = toObservedPoints(frame.landmarks, frame.width, frame.height);
    const { points, transform } = alignToCanonical(observed);
    const { yaw, pitch } = headAngles(transform);
    const frameWeight = Math.abs(yaw) < 10 && Math.abs(pitch) < 10 ? 2 : 1;
    const normals = vertexNormals(observed);
    for (let i = 0; i < VERTEX_COUNT; i++) {
      const w = frameWeight * (0.05 + Math.max(0, normals[i * 3 + 2]) ** 2);
      sum[i * 3] += points[i * 3] * w;
      sum[i * 3 + 1] += points[i * 3 + 1] * w;
      sum[i * 3 + 2] += points[i * 3 + 2] * w;
      weights[i] += w;
    }
  }
  const shape = new Float32Array(VERTEX_COUNT * 3);
  for (let i = 0; i < VERTEX_COUNT; i++) {
    shape[i * 3] = sum[i * 3] / weights[i];
    shape[i * 3 + 1] = sum[i * 3 + 1] / weights[i];
    shape[i * 3 + 2] = sum[i * 3 + 2] / weights[i];
  }
  return shape;
}

/** How each vertex moved from the neutral face, lined up on the parts of the face that don't move. */
export function expressionOffsets(frame: CapturedFrame, neutral: Points): Float32Array {
  const observed = toObservedPoints(frame.landmarks, frame.width, frame.height);
  const aligned = applySimilarity(solveSimilarity(observed, neutral, STABLE_POINTS), observed);
  const offsets = new Float32Array(VERTEX_COUNT * 3);
  for (let i = 0; i < offsets.length; i++) offsets[i] = aligned[i] - neutral[i];
  return offsets;
}

/** Read hair colour just above the forehead in the straight-on photo. */
function sampleHairColor(frame: CapturedFrame, skin: RGB): RGB {
  const image = frame.image!;
  const W = image.width;
  const H = image.height;
  const lm = frame.landmarks;
  const top = [lm[10 * 3] * W, lm[10 * 3 + 1] * H];
  const chin = [lm[152 * 3] * W, lm[152 * 3 + 1] * H];
  const up = [top[0] - chin[0], top[1] - chin[1]];
  const faceH = Math.hypot(up[0], up[1]) || 1;
  const across = [-up[1] / faceH, up[0] / faceH];

  const data = image.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const at = (lift: number, side: number): RGB | null => {
    const x = Math.round(top[0] + up[0] * lift + across[0] * side * faceH);
    const y = Math.round(top[1] + up[1] * lift + across[1] * side * faceH);
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    const p = (y * W + x) * 4;
    return [data[p], data[p + 1], data[p + 2]];
  };
  // Compare against forehead skin from the same photo (same light), just below the hairline.
  const forehead = [-0.05, -0.09].flatMap((lift) => [-0.1, 0, 0.1].map((side) => at(lift, side))).filter((c): c is RGB => !!c);
  const reference = forehead.length ? medianColor(forehead) : skin;
  // Walk up from the top of the forehead and keep only pixels clearly darker
  // than the skin — that's hair; forehead, background and glare are dropped.
  const samples: RGB[] = [];
  for (const lift of [0.03, 0.07, 0.11, 0.15, 0.19, 0.23]) {
    for (const side of [-0.2, -0.1, 0, 0.1, 0.2]) {
      const c = at(lift, side);
      // Blue-grey is almost always a wall behind the head rather than hair.
      if (c && lum(c) < lum(reference) * 0.7 && c[2] <= c[0] + 8) samples.push(c);
    }
  }
  // Light hair (blond, grey) can't be told from skin this way yet; it gets the default until hair is customisable.
  return samples.length >= 4 ? medianColor(samples) : DEFAULT_HAIR;
}
