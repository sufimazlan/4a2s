// Builds the character's head from the player's face profile.
//
// The front of the head is the player's own 468-point face mesh wearing their
// face texture. The rest of the head is grown backwards from the face outline
// (a "loft" towards a pole at the back of the skull), so there is no seam:
// both parts share the outline vertices. Hair, ears and the mouth interior are
// added around it. Everything is in canonical centimetres; the group scales it
// to metres and sits the ear-line centre where the placeholder skull was.

import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
} from 'three';
import { FACE_OVAL, INNER_LIPS, LEFT_EYE, RIGHT_EYE, TRIANGLES, UVS, VERTEX_COUNT } from '../face/canonicalFace';
import { EXPRESSIONS, type ExpressionName, type FaceProfile } from '../face/profile';

export type MorphName = ExpressionName | 'blink';
type V3 = [number, number, number];

/** An egg-shaped frame around the head, centred between the ears, with separate radii per direction. */
export interface HeadFrame {
  c: V3;
  rx: number;
  ryUp: number;
  ryDown: number;
  rzFront: number;
  rzBack: number;
}

/** Material slots on the head mesh. */
const SLOT_FACE = 0;
const SLOT_TEETH = 1;
const SLOT_MOUTH = 2;

/** Rings between the face outline and the back pole. */
const LOFT_RINGS = 14;
/** How far a face expression keeps pulling on the first rings of the loft (fades to 0). */
const LOFT_FOLLOW_RINGS = 4;

const vec = (s: Float32Array, i: number): V3 => [s[i * 3], s[i * 3 + 1], s[i * 3 + 2]];

export function headFrame(shape: Float32Array): HeadFrame {
  const left = vec(shape, 234);
  const right = vec(shape, 454);
  const c: V3 = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2, (left[2] + right[2]) / 2];
  const rx = (Math.abs(right[0] - left[0]) / 2) * 1.04;
  const top = vec(shape, 10);
  const chin = vec(shape, 152);
  let rzFront = 1;
  for (const v of FACE_OVAL) rzFront = Math.max(rzFront, shape[v * 3 + 2] - c[2]);
  return {
    c,
    rx,
    ryUp: (top[1] - c[1]) * 1.55,
    ryDown: Math.max(1, c[1] - chin[1]),
    rzFront,
    rzBack: rx * 1.25,
  };
}

function toUnit(f: HeadFrame, p: V3): V3 {
  const dy = p[1] - f.c[1];
  const dz = p[2] - f.c[2];
  return [(p[0] - f.c[0]) / f.rx, dy / (dy >= 0 ? f.ryUp : f.ryDown), dz / (dz >= 0 ? f.rzFront : f.rzBack)];
}

function fromUnit(f: HeadFrame, u: V3): V3 {
  return [
    f.c[0] + u[0] * f.rx,
    f.c[1] + u[1] * (u[1] >= 0 ? f.ryUp : f.ryDown),
    f.c[2] + u[2] * (u[2] >= 0 ? f.rzFront : f.rzBack),
  ];
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Walk from a point on the face outline (unit-frame coordinates) to the back of
 * the head: the direction slerps to the back pole while the radius eases onto
 * the egg frame. t = 0 is the outline, t = 1 the pole.
 */
function loftUnit(u0: V3, t: number): V3 {
  const r0 = Math.hypot(u0[0], u0[1], u0[2]) || 1;
  const d0: V3 = [u0[0] / r0, u0[1] / r0, u0[2] / r0];
  const omega = Math.acos(Math.max(-1, Math.min(1, -d0[2]))); // angle to the pole (0, 0, -1)
  let d: V3;
  if (omega < 1e-4) {
    d = d0;
  } else {
    const a = Math.sin((1 - t) * omega) / Math.sin(omega);
    const b = Math.sin(t * omega) / Math.sin(omega);
    d = [a * d0[0], a * d0[1], a * d0[2] - b];
  }
  const r = r0 + (1 - r0) * smoothstep(0, 0.45, t);
  return [d[0] * r, d[1] * r, d[2] * r];
}

/** Vertex → neighbouring vertices in the face mesh. */
function faceAdjacency(): Set<number>[] {
  const adj = Array.from({ length: VERTEX_COUNT }, () => new Set<number>());
  for (let i = 0; i < TRIANGLES.length; i += 3) {
    const [a, b, c] = [TRIANGLES[i], TRIANGLES[i + 1], TRIANGLES[i + 2]];
    adj[a].add(b).add(c);
    adj[b].add(a).add(c);
    adj[c].add(a).add(b);
  }
  return adj;
}

/** Synthesise an eyes-closed offset set from the eyelid contours. */
export function blinkOffsets(shape: Float32Array): Float32Array {
  const out = new Float32Array(VERTEX_COUNT * 3);
  const adj = faceAdjacency();

  for (const loop of [RIGHT_EYE, LEFT_EYE]) {
    const inLoop = new Set(loop);
    let left = loop[0];
    let right = loop[0];
    for (const v of loop) {
      if (shape[v * 3] < shape[left * 3]) left = v;
      if (shape[v * 3] > shape[right * 3]) right = v;
    }
    const [lx, ly] = [shape[left * 3], shape[left * 3 + 1]];
    const [rx, ry] = [shape[right * 3], shape[right * 3 + 1]];
    const lineY = (x: number) => ly + ((x - lx) / (rx - lx || 1)) * (ry - ly);

    const upper = loop.filter((v) => v !== left && v !== right && shape[v * 3 + 1] > lineY(shape[v * 3]));
    const lower = [left, right, ...loop.filter((v) => v !== left && v !== right && !upper.includes(v))].sort(
      (a, b) => shape[a * 3] - shape[b * 3],
    );
    // Lower lid height / depth at any x along the eye.
    const lowerAt = (x: number, axis: 1 | 2) => {
      for (let k = 0; k < lower.length - 1; k++) {
        const a = lower[k];
        const b = lower[k + 1];
        if (x >= shape[a * 3] && x <= shape[b * 3]) {
          const t = (x - shape[a * 3]) / (shape[b * 3] - shape[a * 3] || 1);
          return shape[a * 3 + axis] * (1 - t) + shape[b * 3 + axis] * t;
        }
      }
      return shape[lower[x < shape[lower[0] * 3] ? 0 : lower.length - 1] * 3 + axis];
    };

    let gap = 0;
    for (const v of upper) {
      const x = shape[v * 3];
      const dy = lowerAt(x, 1) - shape[v * 3 + 1];
      gap += -dy / upper.length;
      out[v * 3 + 1] = dy * 0.92;
      out[v * 3 + 2] = (lowerAt(x, 2) - shape[v * 3 + 2]) * 0.5 + 0.08;
    }
    for (const v of lower) if (v !== left && v !== right) out[v * 3 + 1] = gap * 0.06;

    // The skin above the lid follows part of the way, so the lid doesn't tear away from the brow.
    let ring = new Set(upper);
    const moved = new Set([...loop]);
    for (const follow of [0.5, 0.2]) {
      const next = new Map<number, { sum: V3; n: number }>();
      for (const v of ring) {
        for (const n of adj[v]) {
          if (moved.has(n) || inLoop.has(n) || shape[n * 3 + 1] <= shape[v * 3 + 1]) continue;
          const entry = next.get(n) ?? { sum: [0, 0, 0], n: 0 };
          entry.sum[1] += out[v * 3 + 1];
          entry.sum[2] += out[v * 3 + 2];
          entry.n++;
          next.set(n, entry);
        }
      }
      for (const [n, { sum, n: count }] of next) {
        out[n * 3 + 1] = (sum[1] / count) * follow;
        out[n * 3 + 2] = (sum[2] / count) * follow;
        moved.add(n);
      }
      ring = new Set(next.keys());
    }
  }
  return out;
}

export interface HeadGeometry {
  geometry: BufferGeometry;
  frame: HeadFrame;
  morphNames: MorphName[];
}

/** Face mesh + loft as one indexed geometry, with face-blend weights and expression morphs. */
export function buildHeadGeometry(
  shape: Float32Array,
  expressions: Partial<Record<ExpressionName, Float32Array>>,
): HeadGeometry {
  const frame = headFrame(shape);
  const ovalCount = FACE_OVAL.length;
  const ringCount = LOFT_RINGS - 1;
  const total = VERTEX_COUNT + ringCount * ovalCount + 1;
  const ringStart = (k: number) => VERTEX_COUNT + (k - 1) * ovalCount;
  const pole = total - 1;
  const ringIndex = (k: number, j: number) => (k === 0 ? FACE_OVAL[j % ovalCount] : ringStart(k) + (j % ovalCount));

  const positions = new Float32Array(total * 3);
  positions.set(shape.subarray(0, VERTEX_COUNT * 3));
  const ovalUnit = FACE_OVAL.map((v) => toUnit(frame, vec(shape, v)));
  for (let k = 1; k <= ringCount; k++) {
    for (let j = 0; j < ovalCount; j++) {
      positions.set(fromUnit(frame, loftUnit(ovalUnit[j], k / LOFT_RINGS)), ringStart(k) * 3 + j * 3);
    }
  }
  positions.set(fromUnit(frame, [0, 0, -1]), pole * 3);

  // Face triangles, minus the ones bridging the lips, so the mouth can open.
  const lips = new Set(INNER_LIPS);
  const indices: number[] = [];
  for (let i = 0; i < TRIANGLES.length; i += 3) {
    const tri = [TRIANGLES[i], TRIANGLES[i + 1], TRIANGLES[i + 2]];
    if (tri.every((v) => lips.has(v))) continue;
    indices.push(...tri);
  }

  // Loft triangles, wound to face outwards from the head centre.
  const loft: number[] = [];
  for (let k = 0; k < ringCount; k++) {
    for (let j = 0; j < ovalCount; j++) {
      const a = ringIndex(k, j);
      const b = ringIndex(k, j + 1);
      const c = ringIndex(k + 1, j + 1);
      const d = ringIndex(k + 1, j);
      loft.push(a, d, b, b, d, c);
    }
  }
  for (let j = 0; j < ovalCount; j++) loft.push(ringIndex(ringCount, j), pole, ringIndex(ringCount, j + 1));
  if (outwardShare(positions, loft, frame.c) < 0.5) {
    for (let i = 0; i < loft.length; i += 3) [loft[i + 1], loft[i + 2]] = [loft[i + 2], loft[i + 1]];
  }
  indices.push(...loft);

  const uvs = new Float32Array(total * 2);
  uvs.set(UVS);
  for (let k = 1; k <= ringCount; k++) {
    for (let j = 0; j < ovalCount; j++) uvs.set(UVS.subarray(FACE_OVAL[j] * 2, FACE_OVAL[j] * 2 + 2), (ringStart(k) + j) * 2);
  }

  // 0 = plain skin tone, 1 = face texture. Fade over the outer two rings of the face.
  const faceBlend = new Float32Array(total);
  const adj = faceAdjacency();
  const depth = new Array<number>(VERTEX_COUNT).fill(Infinity);
  let frontier = [...FACE_OVAL];
  for (const v of frontier) depth[v] = 0;
  for (let d = 1; frontier.length && d < 4; d++) {
    const next: number[] = [];
    for (const v of frontier) for (const n of adj[v]) if (depth[n] === Infinity) (depth[n] = d), next.push(n);
    frontier = next;
  }
  const blendAt = [0, 0.45, 0.85];
  for (let i = 0; i < VERTEX_COUNT; i++) faceBlend[i] = blendAt[depth[i]] ?? 1;

  // Mouth pocket behind the lips, so an open mouth shows teeth and a dark mouth
  // rather than the inside of the head. It has its own copies of the inner-lip
  // vertices (so lip shading isn't bent inwards) and follows every expression.
  const cavity = mouthCavity(shape);
  const all = new Float32Array(total * 3 + cavity.positions.length);
  all.set(positions);
  all.set(cavity.positions, total * 3);
  const allUvs = new Float32Array(all.length / 3 * 2);
  allUvs.set(uvs);
  const allBlend = new Float32Array(all.length / 3);
  allBlend.set(faceBlend);
  const faceCount = indices.length;
  for (const v of cavity.teeth) indices.push(v + total);
  for (const v of cavity.mouth) indices.push(v + total);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(all, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(allUvs, 2));
  geometry.setAttribute('faceBlend', new Float32BufferAttribute(allBlend, 1));
  geometry.setIndex(indices);
  geometry.addGroup(0, faceCount, SLOT_FACE);
  geometry.addGroup(faceCount, cavity.teeth.length, SLOT_TEETH);
  geometry.addGroup(faceCount + cavity.teeth.length, cavity.mouth.length, SLOT_MOUTH);

  const morphs: { name: MorphName; offsets: Float32Array }[] = [];
  for (const name of EXPRESSIONS) {
    const offsets = expressions[name];
    if (offsets?.length === VERTEX_COUNT * 3) morphs.push({ name, offsets });
  }
  morphs.push({ name: 'blink', offsets: blinkOffsets(shape) });

  geometry.morphAttributes.position = morphs.map(({ name, offsets }) => {
    const full = new Float32Array(all.length);
    full.set(offsets);
    full.set(cavity.follow(offsets), total * 3);
    // Let the first loft rings follow the outline (e.g. the chin dropping when laughing).
    for (let k = 1; k <= Math.min(ringCount, LOFT_FOLLOW_RINGS - 1); k++) {
      const follow = 1 - k / LOFT_FOLLOW_RINGS;
      for (let j = 0; j < ovalCount; j++) {
        const from = FACE_OVAL[j] * 3;
        const to = (ringStart(k) + j) * 3;
        full[to] = offsets[from] * follow;
        full[to + 1] = offsets[from + 1] * follow;
        full[to + 2] = offsets[from + 2] * follow;
      }
    }
    const attr = new Float32BufferAttribute(full, 3);
    attr.name = name;
    return attr;
  });
  geometry.morphTargetsRelative = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return { geometry, frame, morphNames: morphs.map((m) => m.name) };
}

interface MouthCavity {
  positions: Float32Array;
  /** Triangles (local vertex indices) drawn as teeth / as the inside of the mouth. */
  teeth: number[];
  mouth: number[];
  /** Expression offsets for the cavity vertices, following the lips. */
  follow(offsets: Float32Array): Float32Array;
}

/**
 * A pocket behind the inner lips: ring A copies the lips, ring B sits 1 cm in,
 * ring C 2.2 cm in and narrower, closed by a point at the back. The band just
 * inside the upper lip is drawn as teeth.
 */
function mouthCavity(shape: Float32Array): MouthCavity {
  const loop = INNER_LIPS;
  const n = loop.length;
  let cx = 0;
  let cy = 0;
  let minZ = Infinity;
  let left = loop[0];
  let right = loop[0];
  for (const v of loop) {
    cx += shape[v * 3] / n;
    cy += shape[v * 3 + 1] / n;
    minZ = Math.min(minZ, shape[v * 3 + 2]);
    if (shape[v * 3] < shape[left * 3]) left = v;
    if (shape[v * 3] > shape[right * 3]) right = v;
  }
  const lineY = (x: number) =>
    shape[left * 3 + 1] + ((x - shape[left * 3]) / (shape[right * 3] - shape[left * 3] || 1)) * (shape[right * 3 + 1] - shape[left * 3 + 1]);
  const upper = loop.map((v) => shape[v * 3 + 1] >= lineY(shape[v * 3]));

  const rings: { inward: number; depth: number; follow: number }[] = [
    { inward: 0, depth: 0, follow: 1 },
    { inward: 0.15, depth: 1.0, follow: 0.9 },
    { inward: 0.55, depth: 2.2, follow: 0.6 },
  ];
  const positions = new Float32Array((rings.length * n + 1) * 3);
  rings.forEach((ring, k) => {
    loop.forEach((v, j) => {
      const x = shape[v * 3];
      const y = shape[v * 3 + 1];
      const z = shape[v * 3 + 2];
      positions.set([x + (cx - x) * ring.inward, y + (cy - y) * ring.inward, (k === 0 ? z : minZ) - ring.depth], (k * n + j) * 3);
    });
  });
  const back = rings.length * n;
  positions.set([cx, cy, minZ - 2.8], back * 3);

  const teeth: number[] = [];
  const mouth: number[] = [];
  for (let k = 0; k < rings.length - 1; k++) {
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      const quad = [k * n + j, (k + 1) * n + j, k * n + j2, k * n + j2, (k + 1) * n + j, (k + 1) * n + j2];
      (k === 0 && upper[j] && upper[j2] ? teeth : mouth).push(...quad);
    }
  }
  const last = (rings.length - 1) * n;
  for (let j = 0; j < n; j++) mouth.push(last + j, back, last + ((j + 1) % n));

  // Face the inside of the pocket towards someone looking into the mouth.
  const viewer: V3 = [cx, cy, minZ + 20];
  for (const tris of [teeth, mouth]) {
    if (towardsShare(positions, tris, viewer) < 0.5) {
      for (let i = 0; i < tris.length; i += 3) [tris[i + 1], tris[i + 2]] = [tris[i + 2], tris[i + 1]];
    }
  }

  return {
    positions,
    teeth,
    mouth,
    follow(offsets) {
      const out = new Float32Array(positions.length);
      const avg = [0, 0, 0];
      rings.forEach((ring, k) => {
        loop.forEach((v, j) => {
          for (let a = 0; a < 3; a++) {
            out[(k * n + j) * 3 + a] = offsets[v * 3 + a] * ring.follow;
            if (k === 0) avg[a] += offsets[v * 3 + a] / n;
          }
        });
      });
      out.set([avg[0] * 0.4, avg[1] * 0.4, avg[2] * 0.4], back * 3);
      return out;
    },
  };
}

/** Fraction of triangles whose normal points towards `point`. */
function towardsShare(positions: Float32Array, indices: ArrayLike<number>, point: V3): number {
  return 1 - outwardShare(positions, indices, point);
}

/** Fraction of triangles whose normal points away from `centre`. */
export function outwardShare(positions: Float32Array, indices: ArrayLike<number>, centre: V3): number {
  let out = 0;
  const n = indices.length / 3;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
    const u = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const v = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const mid = [0, 1, 2].map((k) => (positions[a + k] + positions[b + k] + positions[c + k]) / 3 - centre[k]);
    if (nrm[0] * mid[0] + nrm[1] * mid[1] + nrm[2] * mid[2] > 0) out++;
  }
  return n ? out / n : 1;
}

/**
 * Short hair: the same loft surface pushed slightly outwards, starting at a
 * hairline that is high at the forehead, above the ears at the sides and low at the nape.
 */
export function buildHairGeometry(shape: Float32Array, frame: HeadFrame): BufferGeometry {
  const ovalUnit = FACE_OVAL.map((v) => toUnit(frame, vec(shape, v)));
  const COLS = 180;
  const ROWS = 36;
  const LIFT = 1.045;

  const boundaryAt = (s: number): V3 => {
    const j = Math.floor(s) % ovalUnit.length;
    const f = s - Math.floor(s);
    const a = ovalUnit[j];
    const b = ovalUnit[(j + 1) % ovalUnit.length];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  };
  const isHair = (u: V3) => {
    const len = Math.hypot(u[0], u[1], u[2]) || 1;
    return u[1] / len > 0.1 + 0.45 * (u[2] / len);
  };
  // First t along each column where the hairline condition holds.
  const hairStart = (u0: V3) => {
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!isHair(loftUnit(u0, t))) continue;
      if (i === 0) return 0;
      let lo = (i - 1) / steps;
      let hi = t;
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) / 2;
        if (isHair(loftUnit(u0, mid))) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    return 1;
  };

  const positions = new Float32Array((COLS + 1) * (ROWS + 1) * 3);
  for (let col = 0; col <= COLS; col++) {
    const u0 = boundaryAt((col / COLS) * ovalUnit.length);
    const t0 = hairStart(u0);
    for (let row = 0; row <= ROWS; row++) {
      const t = t0 + (1 - t0) * (row / ROWS);
      const u = loftUnit(u0, t);
      positions.set(fromUnit(frame, [u[0] * LIFT, u[1] * LIFT, u[2] * LIFT]), (col * (ROWS + 1) + row) * 3);
    }
  }
  const indices: number[] = [];
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const a = col * (ROWS + 1) + row;
      const b = (col + 1) * (ROWS + 1) + row;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  if (outwardShare(positions, indices, frame.c) < 0.5) {
    for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export interface FaceHead {
  group: Group;
  morphNames: MorphName[];
  setWeight(name: MorphName, weight: number): void;
  dispose(): void;
}

async function loadTexture(blob: Blob): Promise<Texture> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const texture = new Texture(img);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function srgb([r, g, b]: [number, number, number]): Color {
  return new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
}

export async function createFaceHead(
  profile: FaceProfile,
  materials: { skin: MeshPhysicalMaterial; hair: MeshPhysicalMaterial },
): Promise<FaceHead> {
  const { geometry, frame, morphNames } = buildHeadGeometry(profile.shape, profile.expressions);
  const map = await loadTexture(profile.texture);
  const skinTone = srgb(profile.skinTone);

  const faceMaterial = new MeshPhysicalMaterial({
    map,
    roughness: 0.62,
    sheen: 0.25,
    sheenColor: skinTone.clone().offsetHSL(0, 0, 0.15),
    sheenRoughness: 0.6,
  });
  // Fade the photo into plain skin tone at the edge of the face and over the back of the head.
  faceMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.skinTone = { value: skinTone };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float faceBlend;\nvarying float vFaceBlend;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFaceBlend = faceBlend;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 skinTone;\nvarying float vFaceBlend;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(skinTone, diffuseColor.rgb, vFaceBlend);');
  };
  faceMaterial.customProgramCacheKey = () => '4a2s-face-blend';

  const teethMaterial = new MeshPhysicalMaterial({ color: '#efe9df', roughness: 0.35, clearcoat: 0.3 });
  const mouthMaterial = new MeshPhysicalMaterial({ color: '#3a1518', roughness: 0.9 });
  const materialSlots: MeshPhysicalMaterial[] = [];
  materialSlots[SLOT_FACE] = faceMaterial;
  materialSlots[SLOT_TEETH] = teethMaterial;
  materialSlots[SLOT_MOUTH] = mouthMaterial;
  const head = new Mesh(geometry, materialSlots);
  head.name = 'face-head';

  const hair = new Mesh(buildHairGeometry(profile.shape, frame), materials.hair);
  hair.name = 'hair';

  const ears = ([-1, 1] as const).map((side) => {
    const ear = new Mesh(new SphereGeometry(1, 20, 14), materials.skin);
    ear.position.set(frame.c[0] + side * frame.rx * 0.96, frame.c[1] - 0.6, frame.c[2] - 0.9);
    ear.scale.set(1.0, 3.0, 1.7);
    ear.rotation.y = side * 0.25;
    return ear;
  });

  const group = new Group();
  group.name = 'player-head';
  group.add(head, hair, ...ears);
  group.scale.setScalar(0.01);
  // Ear-line centre → where the placeholder skull centre was (10 cm above the neck pivot).
  group.position.set(-frame.c[0] * 0.01, 0.1 - frame.c[1] * 0.01, -frame.c[2] * 0.01);

  const dictionary = head.morphTargetDictionary ?? {};
  const influences = head.morphTargetInfluences ?? [];
  return {
    group,
    morphNames,
    setWeight(name, weight) {
      const i = dictionary[name];
      if (i !== undefined) influences[i] = weight;
    },
    dispose() {
      geometry.dispose();
      hair.geometry.dispose();
      for (const ear of ears) ear.geometry.dispose();
      faceMaterial.dispose();
      mouthMaterial.dispose();
      teethMaterial.dispose();
      map.dispose();
    },
  };
}
