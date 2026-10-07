// The player's head-and-shoulders character.
//
// Until the player creates their face it wears a placeholder head built from
// primitives. Once a face profile exists, the head is rebuilt from the
// player's own face (see faceHead.ts) and can play their captured expressions.
// Hair, neck, body and clothes stay generic — those get customised in game later.
// Units are metres; the head centre sits at about 1.6 m.

import {
  type BufferGeometry,
  CapsuleGeometry,
  Group,
  LatheGeometry,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from 'three';
import type { ExpressionName, FaceProfile } from '../face/profile';
import { createFaceHead, type FaceHead, type MorphName, srgb } from './faceHead';

const NECK_TOP = 1.48;
/** Slightly larger than life, as stylised characters usually are. */
const HEAD_SCALE = 1.12;
const DEFAULT_SKIN = '#d4a184';
const DEFAULT_HAIR = '#2e211b';

export type Performance = ExpressionName | 'giggle';

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
function placeholderHairGeometry(): BufferGeometry {
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

interface PlaceholderHead {
  group: Group;
  eyes: Group[];
}

function createPlaceholderHead(skin: MeshPhysicalMaterial, hair: MeshPhysicalMaterial): PlaceholderHead {
  const lips = new MeshPhysicalMaterial({ color: '#b86a60', roughness: 0.45, clearcoat: 0.2 });
  const brow = new MeshPhysicalMaterial({ color: '#3b2a22', roughness: 0.9 });
  const sclera = new MeshPhysicalMaterial({ color: '#f4efe9', roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
  const iris = new MeshPhysicalMaterial({ color: '#4a3326', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
  const pupil = new MeshPhysicalMaterial({ color: '#0b0908', roughness: 0.2, clearcoat: 1 });

  const skull = new Mesh(shapeHead(new SphereGeometry(1, 64, 48), 0.1), skin);
  skull.position.y = 0.1;

  const hairCap = new Mesh(placeholderHairGeometry(), hair);
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

  const eyes = ([-1, 1] as const).map((side) => {
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
  });
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

  const group = new Group();
  group.name = 'placeholder-head';
  group.add(skull, hairCap, nose, mouth, ...eyes, ...brows, ...ears);
  return { group, eyes };
}

/** Ramp up, hold, ramp down. */
function envelope(t: number, attack: number, hold: number, release: number): number {
  if (t < 0) return 0;
  if (t < attack) return MathUtils.smootherstep(t / attack, 0, 1);
  if (t < attack + hold) return 1;
  return 1 - MathUtils.smootherstep((t - attack - hold) / release, 0, 1);
}

const EXPRESSION_TIMING = { attack: 0.25, hold: 1.4, release: 0.45 };
const GIGGLE_TIMING = { attack: 0.15, hold: 1.5, release: 0.35 };

export class Character {
  readonly root = new Group();

  private readonly pointer: Vector2;
  private readonly skin = new MeshPhysicalMaterial({
    color: DEFAULT_SKIN,
    roughness: 0.55,
    sheen: 0.35,
    sheenColor: '#ffd8c2',
    sheenRoughness: 0.6,
    clearcoat: 0.05,
  });
  private readonly hair = new MeshPhysicalMaterial({
    color: DEFAULT_HAIR,
    roughness: 0.75,
    sheen: 0.6,
    sheenColor: '#7a5a48',
    sheenRoughness: 0.5,
  });
  private readonly torso: Mesh;
  private readonly head = new Group();
  private readonly placeholder: PlaceholderHead;
  private face: FaceHead | null = null;
  private loadToken = 0;

  private readonly look = new Vector2();
  private elapsed = 0;
  private nextBlink = 2;
  private blinkStart = -1;
  private performance: { name: Performance; start: number } | null = null;

  constructor(pointer: Vector2) {
    this.pointer = pointer;
    this.root.name = 'character';

    const shirt = new MeshPhysicalMaterial({
      color: '#34477a',
      roughness: 0.85,
      sheen: 1,
      sheenColor: '#8ea2d8',
      sheenRoughness: 0.8,
    });
    this.torso = new Mesh(torsoGeometry(), shirt);
    const neck = new Mesh(new CapsuleGeometry(0.058, 0.08, 6, 24), this.skin);
    neck.position.y = 1.47;

    // Everything above the neck turns around a pivot at the top of the neck.
    this.head.position.y = NECK_TOP;
    this.head.scale.setScalar(HEAD_SCALE);
    this.placeholder = createPlaceholderHead(this.skin, this.hair);
    this.head.add(this.placeholder.group);

    this.root.add(this.torso, neck, this.head);
  }

  /** Wear the player's face, or go back to the placeholder with `null`. */
  async setProfile(profile: FaceProfile | null): Promise<void> {
    const token = ++this.loadToken;
    const next = profile ? await createFaceHead(profile, { skin: this.skin, hair: this.hair }) : null;
    if (token !== this.loadToken) {
      next?.dispose();
      return;
    }
    if (this.face) {
      this.head.remove(this.face.group);
      this.face.dispose();
    }
    this.face = next;
    if (next) this.head.add(next.group);
    this.placeholder.group.visible = !next;
    this.skin.color.copy(profile ? srgb(profile.skinTone) : srgb([212, 161, 132]));
    this.hair.color.copy(profile ? srgb(profile.hairColor) : srgb([46, 33, 27]));
    this.performance = null;
  }

  /** Expressions this character can make (the ones the player captured). */
  get expressions(): ExpressionName[] {
    return (this.face?.morphNames.filter((n) => n !== 'blink') ?? []) as ExpressionName[];
  }

  play(name: Performance): void {
    this.performance = { name, start: this.elapsed };
  }

  update(dt: number, t: number): void {
    this.elapsed = t;

    // Breathing.
    this.torso.scale.y = 1 + Math.sin(t * 1.6) * 0.006;

    // Follow the cursor / finger, smoothly, with a little idle sway.
    this.look.x = MathUtils.damp(this.look.x, this.pointer.x, 4, dt);
    this.look.y = MathUtils.damp(this.look.y, this.pointer.y, 4, dt);
    this.head.rotation.set(
      -this.look.y * 0.22 + Math.sin(t * 0.37) * 0.02,
      this.look.x * 0.45 + Math.sin(t * 0.5) * 0.04,
      Math.sin(t * 0.31) * 0.02,
    );
    for (const e of this.placeholder.eyes) {
      e.rotation.y = this.look.x * 0.35;
      e.rotation.x = -this.look.y * 0.25;
    }

    // Blink every few seconds.
    if (this.blinkStart < 0 && t > this.nextBlink) this.blinkStart = t;
    let closed = 0;
    if (this.blinkStart >= 0) {
      const p = (t - this.blinkStart) / 0.18;
      closed = p < 1 ? 1 - Math.abs(1 - 2 * p) : 0;
      if (p >= 1) {
        this.blinkStart = -1;
        this.nextBlink = t + 2.5 + Math.random() * 3;
      }
    }
    for (const e of this.placeholder.eyes) e.scale.y = 1 - closed * 0.9;

    const weights: Partial<Record<MorphName, number>> = { blink: closed };
    this.applyPerformance(t, weights);

    if (this.face) {
      for (const name of this.face.morphNames) this.face.setWeight(name, weights[name] ?? 0);
    }
  }

  private applyPerformance(t: number, weights: Partial<Record<MorphName, number>>): void {
    if (!this.performance) return;
    const local = t - this.performance.start;
    const { name } = this.performance;

    if (name === 'giggle') {
      const { attack, hold, release } = GIGGLE_TIMING;
      const env = envelope(local, attack, hold, release);
      if (local > attack + hold + release) {
        this.performance = null;
        return;
      }
      // Bouncy laugh: ~5 bounces a second on the face, head and shoulders.
      const bounce = Math.abs(Math.sin(local * Math.PI * 5));
      const laugh = this.expressions.includes('laugh') ? 'laugh' : this.expressions.includes('smile') ? 'smile' : null;
      if (laugh) weights[laugh] = env * (0.6 + 0.4 * bounce);
      this.head.rotation.x -= env * (0.05 + 0.05 * bounce);
      this.head.rotation.z += env * 0.05 * Math.sin(local * Math.PI * 2.5);
      this.torso.scale.y += env * 0.012 * bounce;
      return;
    }

    const { attack, hold, release } = EXPRESSION_TIMING;
    if (local > attack + hold + release) {
      this.performance = null;
      return;
    }
    weights[name] = envelope(local, attack, hold, release);
  }
}
