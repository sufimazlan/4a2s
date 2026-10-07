// Bakes the player's camera frames into one face texture in the canonical UV layout.
//
// Each frame is unwrapped triangle by triangle (barycentric rasterisation),
// weighted by how directly that part of the face pointed at the camera, then
// all frames are blended. Broad lighting gradients are evened out so the 3D
// lights don't double up on shading baked into the photo.

import { LEFT_EYE, RIGHT_EYE, TRIANGLES, UVS, VERTEX_COUNT } from './canonicalFace';
import { toObservedPoints, vertexNormals } from './geometry';

export type RGB = [number, number, number];

export interface TextureView {
  /** Full camera frame. */
  image: HTMLCanvasElement;
  /** Packed normalised landmarks for that frame. */
  landmarks: Float32Array;
  /** Extra preference for this view (the straight-on view gets more). */
  weight: number;
}

export const TEXTURE_SIZE = 1024;

/** Cheek landmarks used to read skin tone. */
const CHEEK_POINTS = [50, 280, 101, 330, 205, 425, 123, 352];

/** Eye openings + the ring around them. The eyes look wherever the player looked, so they come from one photo only. */
const EYE_REGION = (() => {
  const set = new Set<number>([...RIGHT_EYE, ...LEFT_EYE]);
  const ring = new Set<number>();
  for (let i = 0; i < TRIANGLES.length; i += 3) {
    const tri = [TRIANGLES[i], TRIANGLES[i + 1], TRIANGLES[i + 2]];
    if (tri.some((v) => set.has(v))) tri.forEach((v) => ring.add(v));
  }
  return ring;
})();

export function bakeFaceTexture(views: TextureView[], size = TEXTURE_SIZE): { canvas: HTMLCanvasElement; skinTone: RGB } {
  const px = size * size;
  const acc = new Float32Array(px * 3);
  const accW = new Float32Array(px);

  // Texture-space vertex positions (canvas pixels, v flipped so row 0 = top).
  const tu = new Float32Array(VERTEX_COUNT);
  const tv = new Float32Array(VERTEX_COUNT);
  for (let i = 0; i < VERTEX_COUNT; i++) {
    tu[i] = UVS[i * 2] * size;
    tv[i] = (1 - UVS[i * 2 + 1]) * size;
  }

  // The straight-on photo owns everything it sees squarely (eyes, nose, mouth);
  // other views only fill in what it sees at a slant, so features don't ghost.
  const primary = views.reduce((best, v) => (v.weight > best.weight ? v : best), views[0]);
  const primaryFacing = facing(primary);
  for (const view of views) {
    const own = facing(view);
    const vw = new Float32Array(VERTEX_COUNT);
    for (let i = 0; i < VERTEX_COUNT; i++) {
      const share = view === primary ? 1 : EYE_REGION.has(i) ? 0 : (1 - primaryFacing[i]) ** 2;
      vw[i] = own[i] ** 4 * view.weight * share;
    }
    unwrapView(view, vw, size, tu, tv, acc, accW);
  }

  const rgba = new Uint8ClampedArray(px * 4);
  const mask = new Uint8Array(px);
  for (let p = 0; p < px; p++) {
    const w = accW[p];
    if (w <= 1e-6) continue;
    mask[p] = 1;
    rgba[p * 4] = acc[p * 3] / w;
    rgba[p * 4 + 1] = acc[p * 3 + 1] / w;
    rgba[p * 4 + 2] = acc[p * 3 + 2] / w;
    rgba[p * 4 + 3] = 255;
  }

  evenOutLighting(rgba, mask, size, sampleSkinTone(rgba, mask, size, tu, tv));
  const skinTone = sampleSkinTone(rgba, mask, size, tu, tv);

  // Pixels no triangle covered (outside the face, mouth gap) get skin tone so
  // texture filtering at the edges never pulls in black.
  for (let p = 0; p < px; p++) {
    if (mask[p]) continue;
    rgba[p * 4] = skinTone[0];
    rgba[p * 4 + 1] = skinTone[1];
    rgba[p * 4 + 2] = skinTone[2];
    rgba[p * 4 + 3] = 255;
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, size, size), 0, 0);
  return { canvas, skinTone };
}

/** How squarely each vertex faced the camera in a view (0 = edge-on or facing away, 1 = straight at it). */
function facing(view: TextureView): Float32Array {
  const normals = vertexNormals(toObservedPoints(view.landmarks, view.image.width, view.image.height));
  const out = new Float32Array(VERTEX_COUNT);
  for (let i = 0; i < VERTEX_COUNT; i++) out[i] = Math.max(0, normals[i * 3 + 2]);
  return out;
}

function unwrapView(
  view: TextureView,
  vw: Float32Array,
  size: number,
  tu: Float32Array,
  tv: Float32Array,
  acc: Float32Array,
  accW: Float32Array,
): void {
  const { image, landmarks } = view;
  const W = image.width;
  const H = image.height;
  const src = image.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;

  for (let t = 0; t < TRIANGLES.length; t += 3) {
    const a = TRIANGLES[t];
    const b = TRIANGLES[t + 1];
    const c = TRIANGLES[t + 2];
    if (vw[a] + vw[b] + vw[c] <= 1e-4) continue;

    // Source triangle in frame pixels; skip ones seen edge-on.
    const sax = landmarks[a * 3] * W, say = landmarks[a * 3 + 1] * H;
    const sbx = landmarks[b * 3] * W, sby = landmarks[b * 3 + 1] * H;
    const scx = landmarks[c * 3] * W, scy = landmarks[c * 3 + 1] * H;
    if (Math.abs((sbx - sax) * (scy - say) - (scx - sax) * (sby - say)) < 0.5) continue;
    // Parts of the face outside the camera frame have no real pixels; leave them to other views.
    if (Math.min(sax, sbx, scx) < 0 || Math.min(say, sby, scy) < 0) continue;
    if (Math.max(sax, sbx, scx) > W - 1 || Math.max(say, sby, scy) > H - 1) continue;

    const ax = tu[a], ay = tv[a];
    const bx = tu[b], by = tv[b];
    const cx = tu[c], cy = tv[c];
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-6) continue;

    // Expand by ~1px so neighbouring triangles overlap instead of leaving cracks.
    const pad = 1;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx) - pad));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx) + pad));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy) - pad));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy) + pad));
    const eps = (pad * 2) / Math.sqrt(Math.abs(area));

    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const pxc = x + 0.5;
        const w0 = ((bx - pxc) * (cy - py) - (cx - pxc) * (by - py)) / area;
        const w1 = ((cx - pxc) * (ay - py) - (ax - pxc) * (cy - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -eps || w1 < -eps || w2 < -eps) continue;

        const weight = Math.max(0, w0 * vw[a] + w1 * vw[b] + w2 * vw[c]);
        if (weight <= 1e-5) continue;

        // Bilinear sample of the camera frame.
        const sx = w0 * sax + w1 * sbx + w2 * scx - 0.5;
        const sy = w0 * say + w1 * sby + w2 * scy - 0.5;
        if (sx < 0 || sy < 0 || sx >= W - 1 || sy >= H - 1) continue;
        const x0 = sx | 0;
        const y0 = sy | 0;
        const fx = sx - x0;
        const fy = sy - y0;
        const i00 = (y0 * W + x0) * 4;
        const i10 = i00 + 4;
        const i01 = i00 + W * 4;
        const i11 = i01 + 4;
        const p = y * size + x;
        for (let ch = 0; ch < 3; ch++) {
          const top = src[i00 + ch] * (1 - fx) + src[i10 + ch] * fx;
          const bottom = src[i01 + ch] * (1 - fx) + src[i11 + ch] * fx;
          acc[p * 3 + ch] += weight * (top * (1 - fy) + bottom * fy);
        }
        accW[p] += weight;
      }
    }
  }
}

/**
 * Divide out broad brightness changes (one side of the face in shadow, a bright
 * forehead) while keeping fine detail. Works on a coarse grid of averages taken
 * over skin-coloured texels only, so a beard, fringe or eyebrows aren't mistaken
 * for shadow.
 */
function evenOutLighting(rgba: Uint8ClampedArray, mask: Uint8Array, size: number, skin: RGB, strength = 0.7): void {
  const skinLuma = Math.max(1, 0.2126 * skin[0] + 0.7152 * skin[1] + 0.0722 * skin[2]);
  const skinRG = skin[0] / Math.max(1, skin[1]);
  const skinGB = skin[1] / Math.max(1, skin[2]);
  const isSkin = (p: number) => {
    const ratio = luma(rgba, p) / skinLuma;
    if (ratio < 0.5 || ratio > 1.7) return false;
    const r = rgba[p * 4], g = Math.max(1, rgba[p * 4 + 1]), b = Math.max(1, rgba[p * 4 + 2]);
    return Math.abs(r / g - skinRG) < 0.3 && Math.abs(g / b - skinGB) < 0.4;
  };
  const G = 24;
  const cell = size / G;
  const sum = new Float32Array(G * G);
  const count = new Float32Array(G * G);
  let total = 0;
  let n = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = y * size + x;
      if (!mask[p] || !isSkin(p)) continue;
      const l = luma(rgba, p);
      const g = Math.min(G - 1, (y / cell) | 0) * G + Math.min(G - 1, (x / cell) | 0);
      sum[g] += l;
      count[g]++;
      total += l;
      n++;
    }
  }
  if (!n) return;
  const mean = total / n;

  // Blur the grid (masked) a few times so the correction is very smooth.
  let level = new Float32Array(G * G);
  let weight = new Float32Array(G * G);
  for (let g = 0; g < G * G; g++) {
    level[g] = sum[g];
    weight[g] = count[g];
  }
  for (let pass = 0; pass < 3; pass++) {
    const nl = new Float32Array(G * G);
    const nw = new Float32Array(G * G);
    for (let gy = 0; gy < G; gy++) {
      for (let gx = 0; gx < G; gx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = gy + dy;
            const nx = gx + dx;
            if (ny < 0 || nx < 0 || ny >= G || nx >= G) continue;
            nl[gy * G + gx] += level[ny * G + nx];
            nw[gy * G + gx] += weight[ny * G + nx];
          }
        }
      }
    }
    level = nl;
    weight = nw;
  }
  const smooth = new Float32Array(G * G);
  for (let g = 0; g < G * G; g++) smooth[g] = weight[g] > 0 ? level[g] / weight[g] : mean;

  for (let y = 0; y < size; y++) {
    const gyf = Math.min(G - 1.001, Math.max(0, y / cell - 0.5));
    const gy0 = gyf | 0;
    const ty = gyf - gy0;
    for (let x = 0; x < size; x++) {
      const p = y * size + x;
      if (!mask[p]) continue;
      const gxf = Math.min(G - 1.001, Math.max(0, x / cell - 0.5));
      const gx0 = gxf | 0;
      const tx = gxf - gx0;
      const l =
        (smooth[gy0 * G + gx0] * (1 - tx) + smooth[gy0 * G + gx0 + 1] * tx) * (1 - ty) +
        (smooth[(gy0 + 1) * G + gx0] * (1 - tx) + smooth[(gy0 + 1) * G + gx0 + 1] * tx) * ty;
      const factor = Math.min(1.5, Math.max(0.7, (mean / Math.max(l, 1)) ** strength));
      rgba[p * 4] *= factor;
      rgba[p * 4 + 1] *= factor;
      rgba[p * 4 + 2] *= factor;
    }
  }
}

function sampleSkinTone(rgba: Uint8ClampedArray, mask: Uint8Array, size: number, tu: Float32Array, tv: Float32Array): RGB {
  const samples: RGB[] = [];
  const r = Math.round(size / 128);
  for (const v of CHEEK_POINTS) {
    const cx = Math.round(tu[v]);
    const cy = Math.round(tv[v]);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const p = y * size + x;
        if (mask[p]) samples.push([rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]]);
      }
    }
  }
  if (!samples.length) return [205, 160, 130];
  return medianColor(samples);
}

export function medianColor(samples: RGB[]): RGB {
  const median = (ch: 0 | 1 | 2) => {
    const sorted = samples.map((s) => s[ch]).sort((a, b) => a - b);
    return Math.round(sorted[sorted.length >> 1]);
  };
  return [median(0), median(1), median(2)];
}

function luma(rgba: Uint8ClampedArray, p: number): number {
  return 0.2126 * rgba[p * 4] + 0.7152 * rgba[p * 4 + 1] + 0.0722 * rgba[p * 4 + 2];
}
