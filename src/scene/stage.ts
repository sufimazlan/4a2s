// The shared Three.js stage: renderer, camera, lights and the render loop.
// One instance lives behind every screen; screens pause it when they need the
// GPU for something else (e.g. face tracking).

import {
  DirectionalLight,
  MathUtils,
  NeutralToneMapping,
  type Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Timer,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { isTouch } from '../platform';

/**
 * Where the character sits on screen. `beside-ui` leaves room for the UI panel:
 * character on the right in landscape, towards the top in portrait.
 */
export type Framing = 'center' | 'beside-ui';

export type UpdateFn = (dt: number, elapsed: number) => void;

const FOV = 30;
/** World-space box (metres) that should fit in view: head and shoulders. */
const FRAME_WIDTH = 0.75;
const FRAME_HEIGHT = 0.8;
const MAX_PIXEL_RATIO = 2;

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 0.05, 50);
  readonly controls: OrbitControls;
  /** Pointer position in -1..1, for things that look at the player's finger / cursor. */
  readonly pointer = new Vector2();

  private readonly container: HTMLElement;
  private readonly timer = new Timer();
  private readonly updates = new Set<UpdateFn>();
  private framing: Framing = 'center';
  private running = false;
  private paused = false;
  private portrait: boolean | undefined;

  static create(container: HTMLElement): Stage | null {
    try {
      return new Stage(container);
    } catch (err) {
      console.error('Could not start 3D renderer', err);
      return null;
    }
  }

  private constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.append(this.renderer.domElement);

    // Soft image-based lighting, generated in code so there is no HDRI file to download yet.
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    const key = new DirectionalLight(0xfff1e0, 2.2);
    key.position.set(-1.2, 2.6, 2.2);
    const rim = new DirectionalLight(0x9fc4ff, 1.4);
    rim.position.set(1.6, 2.2, -2.0);
    this.scene.add(key, rim);

    this.camera.position.set(0.35, 1.6, 2.4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.5, 0);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = isTouch ? 0.8 : 0.6;
    this.controls.minDistance = 0.9;
    this.controls.maxDistance = 4;
    this.controls.minPolarAngle = MathUtils.degToRad(55);
    this.controls.maxPolarAngle = MathUtils.degToRad(110);

    window.addEventListener('pointermove', (e) => {
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    }, { passive: true });

    new ResizeObserver(() => this.resize()).observe(container);
    document.addEventListener('visibilitychange', () => this.syncLoop());
    this.resize();
  }

  add(object: Object3D, update?: UpdateFn): void {
    this.scene.add(object);
    if (update) this.updates.add(update);
  }

  setFraming(framing: Framing): void {
    this.framing = framing;
    this.resize();
  }

  start(): void {
    this.running = true;
    this.syncLoop();
  }

  /** Stop rendering while another screen needs the GPU / battery. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.container.hidden = paused;
    this.syncLoop();
  }

  private syncLoop(): void {
    const active = this.running && !this.paused && document.visibilityState === 'visible';
    if (active) this.timer.reset(); // drop the time spent paused
    this.renderer.setAnimationLoop(active ? () => this.tick() : null);
  }

  private tick(): void {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    const elapsed = this.timer.getElapsed();
    for (const update of this.updates) update(dt, elapsed);
    this.controls.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;

    // Shift the projection centre instead of moving the camera, so orbiting
    // still spins around the character while it sits beside the UI.
    let offsetX = 0;
    let offsetY = 0;
    if (this.framing === 'beside-ui') {
      if (width > height) offsetX = -width * 0.2;
      else offsetY = height * 0.17;
    }
    if (offsetX || offsetY) this.camera.setViewOffset(width, height, offsetX, offsetY, width, height);
    else this.camera.clearViewOffset();

    this.camera.updateProjectionMatrix();

    // Re-frame when the device flips between portrait and landscape.
    const portrait = height > width;
    if (portrait !== this.portrait) {
      this.portrait = portrait;
      this.fitDistance();
    }
  }

  /** Pick a camera distance so head and shoulders fit on any screen shape. */
  private fitDistance(): void {
    const tanHalf = Math.tan(MathUtils.degToRad(FOV / 2));
    const byHeight = FRAME_HEIGHT / 2 / tanHalf;
    const byWidth = FRAME_WIDTH / 2 / (tanHalf * this.camera.aspect);
    const distance = MathUtils.clamp(Math.max(byHeight, byWidth), this.controls.minDistance, this.controls.maxDistance);
    const dir = new Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, distance);
  }
}
