// Character creation: capture the player's face and put it on their character.
//
//   1. Straight on   — relaxed, neutral face, looking at the camera
//   2. Turn          — roll the head in a circle; a Face ID–style ring fills in 8 directions
//   3. Expressions   — smile, laugh, surprised, angry, sad (each can be skipped)
//   4. Build         — shape + texture + expressions → saved on this device → home
//
// Lazy-loaded by the router, so MediaPipe stays out of the home screen bundle.

import type { FaceLandmarkerResult, FaceLandmarker } from '@mediapipe/tasks-vision';
import { blendshapeMap, type Blendshapes, checkNeutral } from '../face/analysis';
import { openFrontCamera, stopStream } from '../face/camera';
import { EXPRESSION_GUIDES } from '../face/expressions';
import { alignToCanonical, headAngles, packLandmarks, toObservedPoints } from '../face/geometry';
import { getFaceLandmarker } from '../face/landmarker';
import { buildProfile, type CapturedFrame, EXPRESSIONS, type ExpressionName } from '../face/profile';
import { saveProfile } from '../face/store';
import { goHome } from '../nav';
import { h, toast } from '../ui';
import type { Screen } from './types';

/** Front step: frames averaged into the straight-on shape. */
const FRONT_FRAMES = 5;
/** Turn step: how far (degrees) the head must turn for a ring segment, and the most we trust. */
const TURN_MIN = 16;
const TURN_MAX = 42;
const SEGMENTS = 8;
/** How long a pose / expression must hold before it snaps (ms). */
const HOLD_MS = 500;

type Step = 'front' | 'turn' | 'expressions' | 'building';

interface FrameInfo {
  packed: Float32Array;
  width: number;
  height: number;
  yaw: number;
  pitch: number;
  shapes: Blendshapes;
  /** Face width as a fraction of the shorter frame side. */
  size: number;
  /** Nose position, -0.5..0.5 from the frame centre. */
  offsetX: number;
  offsetY: number;
  /** Head movement speed in face widths per second (frame-rate independent). */
  motion: number;
  time: number;
}

export function createScreen(): Screen {
  const video = h('video', { class: 'cam-feed', playsinline: true, muted: true, autoplay: true });
  const guide = buildGuide();
  const status = h('p', { class: 'cam-status' }, 'Starting camera…');

  const stepLabel = h('p', { class: 'step-label' });
  const title = h('h3', { class: 'step-title' });
  const instructions = h('p', { class: 'step-text' });
  const meter = h('div', { class: 'meter', hidden: true }, h('span'));
  const actions = h('div', { class: 'step-actions' });
  const panel = h('aside', { class: 'panel create-panel' }, stepLabel, title, instructions, meter, actions);

  const el = h(
    'div',
    { class: 'screen scan create' },
    h(
      'header',
      { class: 'topbar' },
      h('a', { class: 'btn btn-ghost', href: '#/', 'aria-label': 'Back to home', onclick: onBack }, '← Back'),
      h('h2', {}, 'Create your character'),
    ),
    h('div', { class: 'scan-body' }, h('div', { class: 'cam' }, h('div', { class: 'cam-mirror' }, video), guide.svg, status), panel),
  );

  let destroyed = false;
  /** Bumped whenever the step changes, so timers from an earlier step do nothing. */
  let generation = 0;
  let stream: MediaStream | null = null;
  let landmarker: FaceLandmarker | null = null;
  let step: Step = 'front';

  // Captured data.
  const neutral: CapturedFrame[] = [];
  const turnFrames = new Map<number, CapturedFrame>();
  const expressions: Partial<Record<ExpressionName, CapturedFrame>> = {};
  let expressionIndex = 0;

  // Per-step state.
  let goodSince = 0;
  let nearlySince = 0;
  let frontBest: { frame: CapturedFrame; score: number } | null = null;
  let frontCount = 0;
  /** Set by "Capture anyway": take the next frames whatever the checks say. */
  let forceCapture = false;
  let segmentSince = new Map<number, number>();
  let peak: { strength: number; frame: CapturedFrame } | null = null;
  let snapped = false;
  let previous: FrameInfo | null = null;
  let light = { mean: 0.5, balance: 0 };
  let frameNo = 0;

  const setStatus = (text: string) => {
    status.textContent = text;
    status.hidden = !text;
  };

  const button = (label: string, onClick: () => void, kind = 'btn-secondary') =>
    h('button', { class: `btn ${kind}`, type: 'button', onclick: onClick }, label);

  // ---------- Steps ----------

  function showFront(): void {
    generation++;
    step = 'front';
    goodSince = 0;
    nearlySince = 0;
    frontBest = null;
    frontCount = 0;
    forceCapture = false;
    neutral.length = 0;
    stepLabel.textContent = 'Step 1 of 3';
    title.textContent = 'Look straight at the camera';
    instructions.textContent =
      'Keep a relaxed face, no smile. Hold the camera at eye level in soft, even light. Take off glasses if you can.';
    meter.hidden = false;
    setMeter(0);
    actions.replaceChildren();
    guide.setMode('front');
  }

  function showTurn(): void {
    generation++;
    step = 'turn';
    turnFrames.clear();
    segmentSince = new Map();
    stepLabel.textContent = 'Step 2 of 3';
    title.textContent = 'Slowly roll your head in a circle';
    instructions.textContent =
      'Like setting up Face ID: turn left, up, right and down so the ring fills in. This captures the sides of your face.';
    meter.hidden = true;
    renderTurnActions();
    guide.setMode('turn');
    guide.setSegments(new Set());
  }

  function renderTurnActions(): void {
    actions.replaceChildren(
      button(turnFrames.size >= 4 ? 'Continue' : 'Skip', () => showExpressions(0), turnFrames.size >= 4 ? 'btn-primary' : 'btn-secondary'),
    );
  }

  function showExpressions(index: number): void {
    generation++;
    step = 'expressions';
    expressionIndex = index;
    if (index >= EXPRESSIONS.length) return void build();
    const name = EXPRESSIONS[index];
    const g = EXPRESSION_GUIDES[name];
    goodSince = 0;
    peak = null;
    snapped = false;
    delete expressions[name];
    stepLabel.textContent = `Step 3 of 3 · Expression ${index + 1} of ${EXPRESSIONS.length}`;
    title.textContent = `${g.emoji} ${g.title}`;
    instructions.textContent = g.hint;
    meter.hidden = false;
    setMeter(0);
    actions.replaceChildren(
      ...(index > 0 ? [button('← Redo previous', () => showExpressions(index - 1), 'btn-ghost')] : []),
      button('Skip', () => showExpressions(index + 1)),
    );
    guide.setMode('front');
  }

  async function build(): Promise<void> {
    generation++;
    step = 'building';
    stopStream(stream);
    stream = null;
    stepLabel.textContent = 'Almost done';
    title.textContent = 'Building your character…';
    instructions.textContent = 'Putting your face on your character. This takes a few seconds.';
    meter.hidden = true;
    actions.replaceChildren();
    setStatus('Building your character…');
    guide.setMode('none');
    try {
      const profile = await buildProfile({ neutral: [...neutral, ...turnFrames.values()], expressions });
      // Leaving mid-build cancels: don't replace the player's existing face behind their back.
      if (destroyed) return;
      const saved = await saveProfile(profile);
      toast(
        saved
          ? 'Your character now has your face!'
          : 'Your character has your face for now, but this browser won’t let 4a2s keep it (private browsing?).',
        undefined,
        saved ? 5000 : 9000,
      );
      if (!destroyed) goHome();
    } catch (err) {
      console.error(err);
      if (destroyed) return;
      title.textContent = 'Something went wrong';
      instructions.textContent = err instanceof Error ? err.message : 'Could not build your character.';
      actions.replaceChildren(button('Start again', () => void restart(), 'btn-primary'));
    }
  }

  async function restart(): Promise<void> {
    turnFrames.clear();
    for (const name of EXPRESSIONS) delete expressions[name];
    showFront();
    await startCamera();
  }

  // ---------- Per-frame logic ----------

  function onFrame(result: FaceLandmarkerResult): void {
    const info = readFrame(result);
    if (!info) {
      previous = null;
      goodSince = 0;
      setStatus('Looking for your face…');
      guide.setDot(null);
      return;
    }
    guide.setDot(info);
    if (step === 'front') frontStep(info);
    else if (step === 'turn') turnStep(info);
    else if (step === 'expressions') expressionStep(info);
    previous = info;
  }

  function readFrame(result: FaceLandmarkerResult): FrameInfo | null {
    const lm = result.faceLandmarks[0];
    if (!lm) return null;
    const width = video.videoWidth;
    const height = video.videoHeight;
    const packed = packLandmarks(lm);
    const { transform } = alignToCanonical(toObservedPoints(packed, width, height));
    const { yaw, pitch } = headAngles(transform);
    const shapes = blendshapeMap(result.faceBlendshapes?.[0]?.categories ?? []);
    const facePx = Math.hypot((lm[454].x - lm[234].x) * width, (lm[454].y - lm[234].y) * height);
    const time = performance.now();
    const dt = previous ? Math.max(1 / 60, (time - previous.time) / 1000) : 1;
    const motion = previous
      ? Math.hypot((packed[3] - previous.packed[3]) * width, (packed[4] - previous.packed[4]) * height) / (facePx || 1) / dt
      : 10;
    if (frameNo++ % 6 === 0) light = measureLight(lm, width, height);
    return {
      packed,
      width,
      height,
      yaw,
      pitch,
      shapes,
      size: facePx / Math.min(width, height),
      offsetX: lm[1].x - 0.5,
      offsetY: lm[1].y - 0.5,
      motion,
      time,
    };
  }

  function frontStep(f: FrameInfo): void {
    const now = performance.now();
    if (forceCapture) return captureFront(f);
    // Problems that block capture, most important first.
    const framing =
      f.size < 0.28 ? 'Move a little closer' :
      f.size > 0.8 ? 'Move back a little' :
      Math.abs(f.offsetX) > 0.15 || Math.abs(f.offsetY) > 0.18 ? 'Centre your face in the oval' : '';
    const lighting =
      light.mean < 0.22 ? 'Too dark — face a lamp or window' :
      light.mean > 0.88 ? 'Too bright — move out of direct light' :
      Math.abs(light.balance) > 0.35 ? 'Light is uneven — turn to face the light' : '';
    // Pitch is lenient: people look at the screen, which is usually a little below the camera.
    const pose = Math.abs(f.yaw) > 10 || Math.abs(f.pitch) > 15 ? 'Look straight at the camera' : '';
    const neutralCheck = checkNeutral(f.shapes);
    const face = neutralCheck.neutral
      ? ''
      : neutralCheck.offenders[0].startsWith('eyeBlink')
        ? 'Keep your eyes open'
        : 'Relax your face — no smile';
    const still = f.motion > 0.4 ? 'Hold still…' : '';
    const problem = framing || lighting || pose || face || still;

    // Some resting faces read as smiling, some cameras sit at odd angles: offer a manual
    // capture once the face is framed and still for a while, whatever else the checks say.
    if (!framing && !still) {
      nearlySince ||= now;
      if (now - nearlySince > 4000 && (face || lighting || pose) && !actions.childElementCount) {
        actions.append(
          button('Capture anyway', () => {
            forceCapture = true;
            actions.replaceChildren();
          }, 'btn-secondary'),
        );
      }
    } else {
      nearlySince = 0;
    }

    if (problem && frontCount === 0) {
      goodSince = 0;
      setStatus(problem);
      setMeter(0);
      return;
    }
    if (problem) return; // mid-capture: wait for the next good frame
    setStatus(frontCount ? 'Capturing… hold still' : 'Perfect — hold still');
    goodSince ||= now;
    if (frontCount === 0 && now - goodSince < HOLD_MS) {
      setMeter((now - goodSince) / HOLD_MS * 0.5);
      return;
    }
    captureFront(f);
  }

  function captureFront(f: FrameInfo): void {
    const frame = toCaptured(f, true);
    const blink = Math.max(f.shapes.eyeBlinkLeft ?? 0, f.shapes.eyeBlinkRight ?? 0);
    const score = Math.abs(f.yaw) + Math.abs(f.pitch) + f.motion * 10 + blink * 40;
    if (!frontBest || score < frontBest.score) {
      if (frontBest) delete frontBest.frame.image;
      frontBest = { frame, score };
    } else {
      delete frame.image;
    }
    neutral.push(frame);
    frontCount++;
    setMeter(0.5 + (frontCount / FRONT_FRAMES) * 0.5);
    if (frontCount >= FRONT_FRAMES) {
      setStatus('');
      showTurn();
    }
  }

  function turnStep(f: FrameInfo): void {
    const magnitude = Math.hypot(f.yaw, f.pitch);
    const angle = ((Math.atan2(f.pitch, f.yaw) * 180) / Math.PI + 360) % 360;
    const segment = Math.round(angle / (360 / SEGMENTS)) % SEGMENTS;
    const offCentre = Math.abs(angle - segment * (360 / SEGMENTS));
    const smiling = (f.shapes.mouthSmileLeft ?? 0) > 0.5 || (f.shapes.jawOpen ?? 0) > 0.35;
    const blinking = Math.max(f.shapes.eyeBlinkLeft ?? 0, f.shapes.eyeBlinkRight ?? 0) > 0.45;

    if (magnitude < TURN_MIN) setStatus(turnFrames.size ? 'Keep going around the circle' : 'Turn your head slowly');
    else if (magnitude > TURN_MAX) setStatus('Not quite so far');
    else if (smiling) setStatus('Keep a relaxed face');
    else setStatus('');

    const now = performance.now();
    const ok = magnitude >= TURN_MIN && magnitude <= TURN_MAX && Math.min(offCentre, 360 - offCentre) <= 20 && !smiling && !blinking && f.motion < 1.5;
    if (!ok || turnFrames.has(segment)) {
      segmentSince.clear();
      return;
    }
    const since = segmentSince.get(segment) ?? now;
    segmentSince.clear();
    segmentSince.set(segment, since);
    if (now - since < 150) return;

    turnFrames.set(segment, toCaptured(f, true));
    guide.setSegments(new Set(turnFrames.keys()));
    renderTurnActions();
    if (turnFrames.size === SEGMENTS) {
      setStatus('Great!');
      later(() => showExpressions(0), 400);
    }
  }

  function expressionStep(f: FrameInfo): void {
    if (snapped) return;
    const name = EXPRESSIONS[expressionIndex];
    const g = EXPRESSION_GUIDES[name];
    const strength = g.strength(f.shapes);
    setMeter(Math.min(1, strength / g.threshold));
    const now = performance.now();
    const facing = Math.abs(f.yaw) < 20 && Math.abs(f.pitch) < 20;
    if (!facing) {
      setStatus('Face the camera');
      goodSince = 0;
      peak = null;
      return;
    }
    if (strength < g.threshold) {
      setStatus('');
      goodSince = 0;
      peak = null;
      return;
    }
    goodSince ||= now;
    if (!peak || strength > peak.strength) peak = { strength, frame: toCaptured(f, false) };
    setStatus('Hold it…');
    if (now - goodSince < HOLD_MS) return;

    snapped = true;
    expressions[name] = peak.frame;
    setStatus(`${g.emoji} Got it!`);
    later(() => showExpressions(expressionIndex + 1), 700);
  }

  /** Run `fn` after a delay, unless the player moved on (or left) in the meantime. */
  function later(fn: () => void, ms: number): void {
    const at = generation;
    setTimeout(() => {
      if (!destroyed && generation === at) fn();
    }, ms);
  }

  function toCaptured(f: FrameInfo, withImage: boolean): CapturedFrame {
    const frame: CapturedFrame = { landmarks: f.packed, width: f.width, height: f.height };
    if (withImage) {
      const canvas = document.createElement('canvas');
      canvas.width = f.width;
      canvas.height = f.height;
      // Copy the exact frame the landmarks came from (the live video may have moved on).
      canvas.getContext('2d', { willReadFrequently: true })!.drawImage(currentFrame, 0, 0, f.width, f.height);
      frame.image = canvas;
    }
    return frame;
  }

  /** The frame being processed right now; photos copy it so they always match their landmarks. */
  let currentFrame: ImageBitmap | HTMLVideoElement = video;

  // Lighting: average brightness of the face, and left/right balance, on a tiny copy of the frame.
  const lightCanvas = document.createElement('canvas');
  lightCanvas.width = 32;
  lightCanvas.height = 32;
  const lightCtx = lightCanvas.getContext('2d', { willReadFrequently: true })!;
  function measureLight(lm: { x: number; y: number }[], width: number, height: number): { mean: number; balance: number } {
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const v of [10, 152, 234, 454]) {
      minX = Math.min(minX, lm[v].x);
      maxX = Math.max(maxX, lm[v].x);
      minY = Math.min(minY, lm[v].y);
      maxY = Math.max(maxY, lm[v].y);
    }
    const sx = Math.max(0, minX * width);
    const sy = Math.max(0, minY * height);
    const sw = Math.max(1, (maxX - minX) * width);
    const sh = Math.max(1, (maxY - minY) * height);
    // Straight from the video: a frame's difference doesn't matter for average brightness.
    lightCtx.drawImage(video, sx, sy, sw, sh, 0, 0, 32, 32);
    const d = lightCtx.getImageData(0, 0, 32, 32).data;
    let total = 0, left = 0, right = 0;
    for (let y = 4; y < 28; y++) {
      for (let x = 4; x < 28; x++) {
        const p = (y * 32 + x) * 4;
        const l = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255;
        total += l;
        if (x < 16) left += l;
        else right += l;
      }
    }
    const mean = total / (24 * 24);
    return { mean, balance: (left - right) / Math.max(1e-3, left + right) * 2 };
  }

  function setMeter(value: number): void {
    (meter.firstChild as HTMLElement).style.width = `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
  }

  // ---------- Camera + tracking loop ----------

  async function startCamera(): Promise<void> {
    // A retry must not leave the previous camera stream running.
    stopStream(stream);
    stream = null;
    let problem = 'Camera problem';
    try {
      setStatus('Starting camera…');
      const tracker = getFaceLandmarker();
      tracker.catch(() => {}); // handled below; avoid an unhandled rejection while the camera starts
      const opened = await openFrontCamera(video, { width: 1280, height: 720 });
      if (destroyed) return stopStream(opened);
      stream = opened;
      setStatus('Loading face tracker…');
      problem = 'Face tracker problem';
      landmarker = (await tracker.catch((err: unknown) => {
        throw new Error('The face tracker could not load. Check your internet connection and try again.', { cause: err });
      })).landmarker;
      if (destroyed) return;
      setStatus('Looking for your face…');
      loop();
    } catch (err) {
      if (destroyed) return;
      console.error(err);
      setStatus('');
      title.textContent = problem;
      instructions.textContent = err instanceof Error ? err.message : 'The camera could not start.';
      actions.replaceChildren(button('Try again', () => void restart(), 'btn-primary'));
    }
  }

  function loop(): void {
    let lastVideoTime = -1;
    const tick = async () => {
      if (destroyed || !stream || !landmarker) return;
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        // Grab the frame once (a cheap GPU-side copy) and use it for tracking and for any photo
        // taken from it. Falls back to the live video where createImageBitmap(video) isn't supported.
        const still = await createImageBitmap(video).catch(() => null);
        if (destroyed || !stream || !landmarker) return still?.close();
        currentFrame = still ?? video;
        try {
          onFrame(landmarker.detectForVideo(currentFrame, performance.now()));
        } catch (err) {
          console.error(err);
        } finally {
          still?.close();
          currentFrame = video;
        }
      }
      if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(() => void tick());
      else requestAnimationFrame(() => void tick());
    };
    void tick();
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible' && stream && video.paused) void video.play();
  };
  document.addEventListener('visibilitychange', onVisible);

  showFront();
  void startCamera();

  return {
    el,
    framing: null,
    destroy() {
      destroyed = true;
      document.removeEventListener('visibilitychange', onVisible);
      stopStream(stream);
      video.srcObject = null;
    },
  };
}

function onBack(event: Event): void {
  event.preventDefault();
  goHome();
}

// ---------- Guide overlay (oval + Face ID–style ring) ----------

function buildGuide() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'guide');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');

  const oval = document.createElementNS(NS, 'ellipse');
  oval.setAttribute('cx', '50');
  oval.setAttribute('cy', '50');
  oval.setAttribute('rx', '25');
  oval.setAttribute('ry', '33');
  oval.setAttribute('class', 'guide-oval');
  svg.append(oval);

  // Ring segment k is centred on screen angle k·45° (0 = right, 90 = up).
  const R = 42;
  const segments = Array.from({ length: SEGMENTS }, (_, k) => {
    const half = (360 / SEGMENTS / 2 - 3) * (Math.PI / 180);
    const mid = (k * 360 / SEGMENTS) * (Math.PI / 180);
    const p = (a: number) => `${(50 + R * Math.cos(a)).toFixed(2)} ${(50 - R * Math.sin(a)).toFixed(2)}`;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', `M ${p(mid - half)} A ${R} ${R} 0 0 0 ${p(mid + half)}`);
    path.setAttribute('class', 'guide-seg');
    svg.append(path);
    return path;
  });

  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('r', '2.2');
  dot.setAttribute('class', 'guide-dot');
  svg.append(dot);

  return {
    svg,
    setMode(mode: 'front' | 'turn' | 'none') {
      svg.dataset.mode = mode;
    },
    setSegments(done: Set<number>) {
      segments.forEach((s, k) => s.classList.toggle('done', done.has(k)));
    },
    /** Show where the head points (yaw/pitch → position inside the ring). */
    setDot(info: { yaw: number; pitch: number } | null) {
      dot.style.display = info ? '' : 'none';
      if (!info) return;
      const scale = (R - 6) / TURN_MAX;
      const x = Math.max(-R, Math.min(R, info.yaw * scale));
      const y = Math.max(-R, Math.min(R, info.pitch * scale));
      dot.setAttribute('cx', (50 + x).toFixed(2));
      dot.setAttribute('cy', (50 - y).toFixed(2));
    },
  };
}
