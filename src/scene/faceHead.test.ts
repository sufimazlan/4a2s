import { describe, expect, it } from 'vitest';
import { INNER_LIPS, POSITIONS, VERTEX_COUNT } from '../face/canonicalFace';
import { blinkOffsets, buildHairGeometry, buildHeadGeometry, outwardShare } from './faceHead';

const shape = new Float32Array(POSITIONS);

describe('buildHeadGeometry', () => {
  const smile = new Float32Array(VERTEX_COUNT * 3).fill(0.1);
  const { geometry, frame, morphNames } = buildHeadGeometry(shape, { smile });
  const index = geometry.getIndex()!.array;
  const positions = geometry.getAttribute('position').array as Float32Array;

  const faceEnd = geometry.groups[0].count;
  const vertexCount = geometry.getAttribute('position').count;
  const key = (i: number) => [0, 1, 2].map((k) => positions[i * 3 + k].toFixed(4)).join(',');

  it('is closed, with the mouth opening sealed by the mouth pocket', () => {
    // Count edges by position, so the pocket's copies of the lip vertices join up with the lips.
    const uses = new Map<string, number>();
    for (let i = 0; i < index.length; i += 3) {
      for (const [a, b] of [[index[i], index[i + 1]], [index[i + 1], index[i + 2]], [index[i + 2], index[i]]]) {
        const [ka, kb] = [key(a), key(b)];
        const edge = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        uses.set(edge, (uses.get(edge) ?? 0) + 1);
      }
    }
    expect([...uses.values()].every((n) => n === 2)).toBe(true);
  });

  it('keeps the face mesh itself open only at the inner lips', () => {
    const uses = new Map<string, number>();
    for (let i = 0; i < faceEnd; i += 3) {
      for (const [a, b] of [[index[i], index[i + 1]], [index[i + 1], index[i + 2]], [index[i + 2], index[i]]]) {
        const edge = a < b ? `${a},${b}` : `${b},${a}`;
        uses.set(edge, (uses.get(edge) ?? 0) + 1);
      }
    }
    const open = [...uses].filter(([, n]) => n === 1).map(([k]) => k.split(',').map(Number));
    const lips = new Set(INNER_LIPS);
    expect(open.length).toBe(INNER_LIPS.length);
    expect(open.every(([a, b]) => lips.has(a) && lips.has(b))).toBe(true);
  });

  it('winds every back-of-head triangle outwards', () => {
    const loft = Array.from(index).slice(faceEnd - (36 * 13 * 2 + 36) * 3, faceEnd);
    expect(outwardShare(positions, loft, frame.c)).toBe(1);
  });

  it('faces the mouth pocket towards someone looking into the mouth', () => {
    const pocket = Array.from(index).slice(faceEnd);
    const front: [number, number, number] = [0, POSITIONS[13 * 3 + 1], 30];
    expect(outwardShare(positions, pocket, front)).toBe(0);
  });

  it('moves the mouth pocket with the expressions', () => {
    const morph = geometry.morphAttributes.position![0].array as Float32Array;
    // Last vertex is the back of the pocket; ring A (lip copies) follows the lips fully.
    const lipCopy = vertexCount - 1 - 3 * INNER_LIPS.length;
    expect(morph[lipCopy * 3]).toBeCloseTo(0.1, 5);
    expect(morph[(vertexCount - 1) * 3]).toBeCloseTo(0.04, 5);
  });

  it('puts the back of the head behind the ears and the crown above the forehead', () => {
    let minZ = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      minZ = Math.min(minZ, positions[i + 2]);
      maxY = Math.max(maxY, positions[i + 1]);
    }
    expect(frame.c[2] - minZ).toBeGreaterThan(8);
    expect(maxY).toBeGreaterThan(POSITIONS[10 * 3 + 1] + 2);
  });

  it('has the captured expressions plus a blink as morph targets', () => {
    expect(morphNames).toEqual(['smile', 'blink']);
    expect(geometry.morphAttributes.position).toHaveLength(2);
    expect(geometry.morphAttributes.position![0].count).toBe(geometry.getAttribute('position').count);
  });

  it('fades the face texture out at the face edge and over the loft', () => {
    const blend = geometry.getAttribute('faceBlend').array as Float32Array;
    expect(blend[10]).toBe(0); // forehead top, on the outline
    expect(blend[1]).toBe(1); // nose tip
    expect(blend[VERTEX_COUNT + 5]).toBe(0); // loft
  });
});

describe('mouth pocket teeth', () => {
  const teethTriangles = (s: Float32Array) => buildHeadGeometry(s, {}).geometry.groups[1].count / 3;

  it('keeps the same teeth whatever the player’s closed-mouth lips look like', () => {
    const expected = teethTriangles(shape);
    expect(expected).toBeGreaterThan(0);
    // Close the lips (both sides onto their midline) and nudge the corners up / down.
    for (const nudge of [-0.1, 0, 0.1]) {
      const closed = new Float32Array(shape);
      const mid = (POSITIONS[13 * 3 + 1] + POSITIONS[14 * 3 + 1]) / 2;
      for (const v of INNER_LIPS) closed[v * 3 + 1] = mid + (POSITIONS[v * 3 + 1] - mid) * 0.04;
      for (const corner of [78, 308]) closed[corner * 3 + 1] += nudge;
      expect(teethTriangles(closed)).toBe(expected);
    }
  });
});

describe('blinkOffsets', () => {
  const blink = blinkOffsets(shape);
  const y = (v: number) => POSITIONS[v * 3 + 1];

  it('closes both upper lids onto the lower lids', () => {
    for (const [upper, lower] of [[159, 145], [386, 374]]) {
      const closedY = y(upper) + blink[upper * 3 + 1];
      expect(blink[upper * 3 + 1]).toBeLessThan(0);
      expect(Math.abs(closedY - y(lower))).toBeLessThan((y(upper) - y(lower)) * 0.2);
    }
  });

  it('leaves the mouth alone', () => {
    for (const v of [13, 14, 61, 291]) expect(blink[v * 3 + 1]).toBe(0);
  });
});

describe('buildHairGeometry', () => {
  const { frame } = buildHeadGeometry(shape, {});
  const hair = buildHairGeometry(shape, frame);
  const pos = hair.getAttribute('position').array as Float32Array;

  it('stays off the face', () => {
    const foreheadTop = POSITIONS[10 * 3 + 1];
    const midForehead = (frame.c[1] + foreheadTop) / 2;
    for (let i = 0; i < pos.length; i += 3) {
      const inFront = pos[i + 2] > frame.c[2] + frame.rzFront * 0.5;
      if (!inFront) continue;
      // Hair may come down to mid-forehead height at the temples, but not in the middle.
      expect(pos[i + 1]).toBeGreaterThan(midForehead);
      if (Math.abs(pos[i]) < frame.rx * 0.4) expect(pos[i + 1]).toBeGreaterThan(foreheadTop - 1);
    }
  });

  it('covers the crown and the back of the head', () => {
    let crown = false;
    let back = false;
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i + 1] > frame.c[1] + frame.ryUp * 0.95) crown = true;
      if (pos[i + 2] < frame.c[2] - frame.rzBack * 0.95) back = true;
    }
    expect(crown && back).toBe(true);
  });
});
