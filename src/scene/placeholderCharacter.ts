// A stand-in head-and-shoulders character built from primitives.
// Phase 3 replaces it with the Blender base head (likeness morph targets +
// 52 ARKit expression shape keys). Units are metres, head centre ≈ 1.6 m.

import {
  type BufferGeometry,
  CapsuleGeometry,
  TorusGeometry,
  Group,
  LatheGeometry,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  SphereGeometry,
  Vector2,
} from 'three';
import type { UpdateFn } from './stage';

const NECK_TOP = 1.48;
/** Slightly larger than life, as stylised characters usually are. */
const HEAD_SCALE = 1.12;

const skin = new MeshPhysicalMaterial({
  color: '#d4a184',
  roughness: 0.55,
  sheen: 0.35,
  sheenColor: '#ffd8c2',
  sheenRoughness: 0.6,
  clearcoat: 0.05,
});
const lips = new MeshPhysicalMaterial({ color: '#b86a60', roughness: 0.45, clearcoat: 0.2 });
const brow = new MeshPhysicalMaterial({ color: '#3b2a22', roughness: 0.9 });
const hair = new MeshPhysicalMaterial({
  color: '#2e211b',
  roughness: 0.75,
  sheen: 0.6,
  sheenColor: '#7a5a48',
  sheenRoughness: 0.5,
});
const sclera = new MeshPhysicalMaterial({ color: '#f4efe9', roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
const iris = new MeshPhysicalMaterial({ color: '#4a3326', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
const pupil = new MeshPhysicalMaterial({ color: '#0b0908', roughness: 0.2, clearcoat: 1 });
const shirt = new MeshPhysicalMaterial({
  color: '#34477a',
  roughness: 0.85,
  sheen: 1,
  sheenColor: '#8ea2d8',
  sheenRoughness: 0.8,
});

/** An ellipsoid nudged into a head shape: narrower jaw, flatter face, rounder back. */
function shapeHead<T extends BufferGeometry>(geo: T, size: number): T {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const jaw = y < 0 ? 1 - 0.3 * Math.pow(-y, 1.6) : 1;
    x *= 0.8 * jaw;
    z *= z > 0 ? 0.9 * (y < -0.5 ? 1 - 0.15 * (-y - 0.5) : 1) : 1.05;
    // Rounder crown instead of an egg tip.
    y *= y > 0.4 ? 1.1 - 0.12 * (y - 0.4) : 1.1;
    pos.setXYZ(i, x * size, y * size, z * size);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Short hair: the part of the head above a hairline that is high at the forehead and low at the nape. */
function hairGeometry(): BufferGeometry {
  const geo = new SphereGeometry(1, 128, 96);
  const pos = geo.attributes.position;
  const index = geo.index!;
  const onScalp = (i: number) => pos.getY(i) > 0.18 + 0.45 * pos.getZ(i);
  const kept: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    if (onScalp(a) && onScalp(b) && onScalp(c)) kept.push(a, b, c);
  }
  geo.setIndex(kept);
  return shapeHead(geo, 0.106);
}

function torsoGeometry(): LatheGeometry {
  // Profile of chest → shoulders → base of neck, spun around the Y axis.
  const profile = [
    [0.165, 1.0], [0.175, 1.15], [0.19, 1.27], [0.198, 1.32], [0.172, 1.385],
    [0.12, 1.43], [0.075, 1.455], [0.0, 1.465],
  ].map(([r, y]) => new Vector2(r, y));
  const geo = new LatheGeometry(profile, 48);
  geo.scale(1, 1, 0.58);
  return geo;
}

function eye(side: 1 | -1): Group {
  const group = new Group();
  group.position.set(side * 0.032, 0.115, 0.07);
  const ball = new Mesh(new SphereGeometry(0.0125, 24, 16), sclera);
  const irisMesh = new Mesh(new SphereGeometry(0.0062, 20, 12), iris);
  irisMesh.scale.z = 0.45;
  irisMesh.position.z = 0.0105;
  const pupilMesh = new Mesh(new SphereGeometry(0.0028, 12, 8), pupil);
  pupilMesh.scale.z = 0.4;
  pupilMesh.position.z = 0.0128;
  group.add(ball, irisMesh, pupilMesh);
  return group;
}

export function createPlaceholderCharacter(pointer: Vector2): { root: Group; update: UpdateFn } {
  const root = new Group();
  root.name = 'placeholder-character';

  const torso = new Mesh(torsoGeometry(), shirt);
  const neck = new Mesh(new CapsuleGeometry(0.058, 0.08, 6, 24), skin);
  neck.position.y = 1.47;

  // Everything above the neck turns around a pivot at the top of the neck.
  const head = new Group();
  head.position.y = NECK_TOP;
  head.scale.setScalar(HEAD_SCALE);

  const skull = new Mesh(shapeHead(new SphereGeometry(1, 64, 48), 0.1), skin);
  skull.position.y = 0.1;

  const hairCap = new Mesh(hairGeometry(), hair);
  hairCap.position.y = 0.1;

  const nose = new Mesh(new CapsuleGeometry(0.0085, 0.028, 6, 16), skin);
  nose.position.set(0, 0.085, 0.087);
  nose.rotation.x = -0.4;
  nose.scale.set(1.25, 1, 1);

  // A shallow arc: a relaxed, slightly friendly mouth.
  const smileArc = 1.1;
  const mouth = new Mesh(new TorusGeometry(0.024, 0.0042, 8, 24, smileArc), lips);
  mouth.position.set(0, 0.044 + 0.024, 0.079);
  mouth.rotation.z = -Math.PI / 2 - smileArc / 2;
  mouth.scale.z = 0.6;

  const eyes = [eye(-1), eye(1)];
  const brows = ([-1, 1] as const).map((side) => {
    const b = new Mesh(new CapsuleGeometry(0.0032, 0.024, 4, 12), brow);
    b.position.set(side * 0.034, 0.138, 0.08);
    b.rotation.z = Math.PI / 2 - side * 0.06;
    return b;
  });
  const ears = ([-1, 1] as const).map((side) => {
    const e = new Mesh(new SphereGeometry(1, 20, 14), skin);
    e.position.set(side * 0.074, 0.1, -0.008);
    e.scale.set(0.011, 0.03, 0.019);
    return e;
  });

  head.add(skull, hairCap, nose, mouth, ...eyes, ...brows, ...ears);
  root.add(torso, neck, head);

  let nextBlink = 2;
  let blinkStart = -1;
  const look = new Vector2();

  const update: UpdateFn = (dt, t) => {
    // Breathing.
    torso.scale.y = 1 + Math.sin(t * 1.6) * 0.006;

    // Follow the cursor / finger, smoothly, with a little idle sway.
    look.x = MathUtils.damp(look.x, pointer.x, 4, dt);
    look.y = MathUtils.damp(look.y, pointer.y, 4, dt);
    head.rotation.y = look.x * 0.45 + Math.sin(t * 0.5) * 0.04;
    head.rotation.x = -look.y * 0.22 + Math.sin(t * 0.37) * 0.02;
    head.rotation.z = Math.sin(t * 0.31) * 0.02;
    for (const e of eyes) {
      e.rotation.y = look.x * 0.35;
      e.rotation.x = -look.y * 0.25;
    }

    // Blink every few seconds.
    if (blinkStart < 0 && t > nextBlink) blinkStart = t;
    let lid = 1;
    if (blinkStart >= 0) {
      const p = (t - blinkStart) / 0.16;
      lid = p < 1 ? Math.abs(1 - 2 * p) * 0.9 + 0.1 : 1;
      if (p >= 1) {
        blinkStart = -1;
        nextBlink = t + 2.5 + Math.random() * 3;
      }
    }
    for (const e of eyes) e.scale.y = lid;
  };

  return { root, update };
}
