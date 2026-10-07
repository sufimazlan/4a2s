// 3D maths for turning per-frame landmarks into one face shape.
//
// "Observed" space: image pixels with x right, y up and z towards the camera
// (MediaPipe's z is scaled like x and grows away from the camera, so it is negated).
// "Canonical" space: MediaPipe's canonical face model in centimetres, same axes.

import { POSITIONS, TRIANGLES, VERTEX_COUNT } from './canonicalFace';

/** VERTEX_COUNT × xyz. */
export type Points = Float32Array;

/** Landmarks that barely move with expressions — used to line expressions up with the neutral face. */
export const STABLE_POINTS = [
  10, 109, 67, 103, 338, 297, 332, 151, 9, 8, 168, 6, 197, 195, 5, 4,
  133, 362, 234, 454, 127, 356, 21, 251, 54, 284, 162, 389,
];

/** Copy MediaPipe's normalised landmarks into a compact array (x, y, z per landmark). */
export function packLandmarks(landmarks: ArrayLike<{ x: number; y: number; z: number }>): Float32Array {
  const out = new Float32Array(landmarks.length * 3);
  for (let i = 0; i < landmarks.length; i++) {
    out[i * 3] = landmarks[i].x;
    out[i * 3 + 1] = landmarks[i].y;
    out[i * 3 + 2] = landmarks[i].z;
  }
  return out;
}

/** Packed normalised landmarks → observed-space points for the 468 mesh vertices (irises dropped). */
export function toObservedPoints(packed: Float32Array, width: number, height: number): Points {
  const out = new Float32Array(VERTEX_COUNT * 3);
  for (let i = 0; i < VERTEX_COUNT; i++) {
    out[i * 3] = packed[i * 3] * width;
    out[i * 3 + 1] = -packed[i * 3 + 1] * height;
    out[i * 3 + 2] = -packed[i * 3 + 2] * width;
  }
  return out;
}

/** dst ≈ s · R · src + t.  R is row-major 3×3. */
export interface Similarity {
  r: Float64Array;
  s: number;
  t: [number, number, number];
}

/**
 * Least-squares similarity transform taking `src` onto `dst` (Horn's quaternion method),
 * fitted on `indices` (all vertices by default).
 */
export function solveSimilarity(src: Points, dst: Points, indices?: ArrayLike<number>): Similarity {
  const n = indices ? indices.length : src.length / 3;
  const at = (k: number) => (indices ? indices[k] : k);

  const ma = [0, 0, 0];
  const mb = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    const i = at(k) * 3;
    for (let d = 0; d < 3; d++) {
      ma[d] += src[i + d] / n;
      mb[d] += dst[i + d] / n;
    }
  }

  // S[p][q] = Σ a_p · b_q over centred points.
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let aa = 0;
  for (let k = 0; k < n; k++) {
    const i = at(k) * 3;
    const a = [src[i] - ma[0], src[i + 1] - ma[1], src[i + 2] - ma[2]];
    const b = [dst[i] - mb[0], dst[i + 1] - mb[1], dst[i + 2] - mb[2]];
    aa += a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
    for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) S[p][q] += a[p] * b[q];
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const { values, vectors } = jacobiEigen(N);
  let best = 0;
  for (let k = 1; k < 4; k++) if (values[k] > values[best]) best = k;
  const [w, x, y, z] = vectors.map((row) => row[best]);
  const r = new Float64Array([
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ]);

  // Scale: Σ b·(R a) / Σ |a|².
  let ab = 0;
  for (let k = 0; k < n; k++) {
    const i = at(k) * 3;
    const a = [src[i] - ma[0], src[i + 1] - ma[1], src[i + 2] - ma[2]];
    const b = [dst[i] - mb[0], dst[i + 1] - mb[1], dst[i + 2] - mb[2]];
    for (let p = 0; p < 3; p++) ab += b[p] * (r[p * 3] * a[0] + r[p * 3 + 1] * a[1] + r[p * 3 + 2] * a[2]);
  }
  const s = aa > 0 ? ab / aa : 1;
  const t: [number, number, number] = [0, 1, 2].map(
    (p) => mb[p] - s * (r[p * 3] * ma[0] + r[p * 3 + 1] * ma[1] + r[p * 3 + 2] * ma[2]),
  ) as [number, number, number];
  return { r, s, t };
}

export function applySimilarity(T: Similarity, src: Points): Points {
  const out = new Float32Array(src.length);
  const { r, s, t } = T;
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i];
    const y = src[i + 1];
    const z = src[i + 2];
    out[i] = s * (r[0] * x + r[1] * y + r[2] * z) + t[0];
    out[i + 1] = s * (r[3] * x + r[4] * y + r[5] * z) + t[1];
    out[i + 2] = s * (r[6] * x + r[7] * y + r[8] * z) + t[2];
  }
  return out;
}

/** Observed points → canonical space, fitted on every vertex. */
export function alignToCanonical(observed: Points): { points: Points; transform: Similarity } {
  const transform = solveSimilarity(observed, POSITIONS);
  return { points: applySimilarity(transform, observed), transform };
}

/**
 * Where the head faces, from an observed→canonical transform, in the terms the
 * player sees in the mirrored preview: yaw > 0 = nose towards the right of the
 * screen, pitch > 0 = looking up. Degrees.
 */
export function headAngles(T: Similarity): { yaw: number; pitch: number } {
  // Head rotation is Rᵀ; its forward axis is Rᵀ·ẑ = third row of R.
  const fx = T.r[6];
  const fy = T.r[7];
  const fz = T.r[8];
  const deg = 180 / Math.PI;
  return {
    yaw: Math.atan2(-fx, fz) * deg,
    pitch: Math.asin(Math.max(-1, Math.min(1, fy))) * deg,
  };
}

/** Area-weighted vertex normals for the face mesh. */
export function vertexNormals(points: Points): Float32Array {
  const normals = new Float32Array(points.length);
  for (let i = 0; i < TRIANGLES.length; i += 3) {
    const a = TRIANGLES[i] * 3;
    const b = TRIANGLES[i + 1] * 3;
    const c = TRIANGLES[i + 2] * 3;
    const ux = points[b] - points[a];
    const uy = points[b + 1] - points[a + 1];
    const uz = points[b + 2] - points[a + 2];
    const vx = points[c] - points[a];
    const vy = points[c + 1] - points[a + 1];
    const vz = points[c + 2] - points[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      normals[v] += nx;
      normals[v + 1] += ny;
      normals[v + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len;
    normals[i + 1] /= len;
    normals[i + 2] /= len;
  }
  return normals;
}

/** Eigen-decomposition of a small symmetric matrix (cyclic Jacobi). Eigenvectors are the columns of `vectors`. */
export function jacobiEigen(matrix: number[][]): { values: number[]; vectors: number[][] } {
  const n = matrix.length;
  const a = matrix.map((row) => [...row]);
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 64; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-30) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: a.map((row, i) => row[i]), vectors: v };
}
