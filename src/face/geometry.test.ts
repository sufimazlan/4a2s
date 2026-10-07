import { describe, expect, it } from 'vitest';
import { POSITIONS } from './canonicalFace';
import { applySimilarity, headAngles, jacobiEigen, solveSimilarity, STABLE_POINTS, toObservedPoints, type Similarity } from './geometry';

function rotation(yawDeg: number, pitchDeg: number, rollDeg: number): Float64Array {
  const [y, p, r] = [yawDeg, pitchDeg, rollDeg].map((d) => (d * Math.PI) / 180);
  // R = Ry(yaw) · Rx(-pitch) · Rz(roll): positive pitch tilts the face (+z) upwards.
  const Ry = [Math.cos(y), 0, Math.sin(y), 0, 1, 0, -Math.sin(y), 0, Math.cos(y)];
  const Rx = [1, 0, 0, 0, Math.cos(-p), -Math.sin(-p), 0, Math.sin(-p), Math.cos(-p)];
  const Rz = [Math.cos(r), -Math.sin(r), 0, Math.sin(r), Math.cos(r), 0, 0, 0, 1];
  const mul = (A: number[], B: number[]) =>
    Array.from({ length: 9 }, (_, k) => {
      const i = Math.floor(k / 3);
      const j = k % 3;
      return A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    });
  return new Float64Array(mul(mul(Ry, Rx), Rz));
}

function maxError(a: Float32Array, b: Float32Array): number {
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
}

describe('jacobiEigen', () => {
  it('diagonalises a symmetric matrix', () => {
    const m = [[4, 1, 2, 0], [1, 3, 0, 1], [2, 0, 5, 1], [0, 1, 1, 2]];
    const { values, vectors } = jacobiEigen(m);
    for (let k = 0; k < 4; k++) {
      const v = vectors.map((row) => row[k]);
      const mv = m.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
      mv.forEach((x, i) => expect(x).toBeCloseTo(values[k] * v[i], 9));
    }
  });
});

describe('solveSimilarity', () => {
  it('recovers a known rotation, scale and translation', () => {
    const truth: Similarity = { r: rotation(30, -15, 10), s: 12.5, t: [320, -240, 40] };
    const moved = applySimilarity(truth, POSITIONS);
    const back = solveSimilarity(moved, POSITIONS);
    expect(maxError(applySimilarity(back, moved), POSITIONS)).toBeLessThan(1e-3);
    expect(back.s).toBeCloseTo(1 / 12.5, 6);
  });

  it('fits on a subset of points', () => {
    const truth: Similarity = { r: rotation(-20, 5, 0), s: 3, t: [1, 2, 3] };
    const moved = applySimilarity(truth, POSITIONS);
    const back = solveSimilarity(moved, POSITIONS, STABLE_POINTS);
    expect(maxError(applySimilarity(back, moved), POSITIONS)).toBeLessThan(1e-3);
  });
});

describe('headAngles', () => {
  // Simulate the camera seeing the canonical face turned by a known amount.
  const observe = (yaw: number, pitch: number) => {
    const turned = applySimilarity({ r: rotation(yaw, pitch, 0), s: 20, t: [300, -200, 0] }, POSITIONS);
    return headAngles(solveSimilarity(turned, POSITIONS));
  };

  it('is zero facing the camera', () => {
    const a = observe(0, 0);
    expect(a.yaw).toBeCloseTo(0, 3);
    expect(a.pitch).toBeCloseTo(0, 3);
  });

  it('reports yaw in mirrored-preview terms', () => {
    // Rotating +yaw about y moves the nose towards +x in the camera image (the
    // person's left), which shows up on the LEFT of a mirrored preview.
    expect(observe(25, 0).yaw).toBeCloseTo(-25, 2);
    expect(observe(-25, 0).yaw).toBeCloseTo(25, 2);
  });

  it('reports looking up as positive pitch', () => {
    expect(observe(0, 20).pitch).toBeCloseTo(20, 2);
    expect(observe(0, -20).pitch).toBeCloseTo(-20, 2);
  });
});

describe('toObservedPoints', () => {
  it('flips y and z into a y-up, towards-camera frame', () => {
    const packed = new Float32Array(478 * 3);
    packed.set([0.25, 0.5, -0.1]);
    const pts = toObservedPoints(packed, 640, 480);
    expect([pts[0], pts[1], pts[2]]).toEqual([160, -240, 64]);
  });
});
