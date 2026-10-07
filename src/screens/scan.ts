// Phase 1 face tracking test: camera + MediaPipe Face Landmarker with a debug
// overlay (landmarks, head pose, neutral-face check, top blendshapes, speed).
// The real two-step capture flow (guide ring, expression snaps) builds on this.

// This module is lazy-loaded by the router, so MediaPipe stays out of the home screen bundle.

import { DrawingUtils, FaceLandmarker, type FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import { blendshapeMap, checkNeutral, headPoseFromMatrix } from '../face/analysis';
import { openFrontCamera, stopStream } from '../face/camera';
import { getFaceLandmarker } from '../face/landmarker';
import { goHome } from '../nav';
import { h } from '../ui';
import type { Screen } from './types';

export function scanScreen(): Screen {
  const video = h('video', { class: 'cam-feed', playsinline: true, muted: true, autoplay: true });
  const overlay = h('canvas', { class: 'cam-overlay' });
  const status = h('p', { class: 'cam-status' }, 'Loading face tracker…');
  const retry = h('button', { class: 'btn btn-primary', type: 'button', hidden: true }, 'Try again');
  const meshToggle = h('input', { type: 'checkbox', checked: true });

  const stat = (label: string) => {
    const value = h('span', { class: 'stat-value' }, '–');
    return { row: h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), value), value };
  };
  const engine = stat('Tracker');
  const speed = stat('Speed');
  const pose = stat('Head');
  const neutral = stat('Neutral face');
  const shapes = h('ul', { class: 'shapes' });

  const el = h(
    'div',
    { class: 'screen scan' },
    h(
      'header',
      { class: 'topbar' },
      h('a', {
        class: 'btn btn-ghost',
        href: '#/',
        'aria-label': 'Back to home',
        onclick: (e: Event) => {
          e.preventDefault();
          goHome();
        },
      }, '← Back'),
      h('h2', {}, 'Face tracking test'),
    ),
    h(
      'div',
      { class: 'scan-body' },
      h('div', { class: 'cam' }, h('div', { class: 'cam-mirror' }, video, overlay), status, retry),
      h(
        'aside',
        { class: 'panel hud' },
        engine.row,
        speed.row,
        pose.row,
        neutral.row,
        h('h3', {}, 'Strongest expressions'),
        shapes,
        h('label', { class: 'toggle' }, meshToggle, ' Show face mesh'),
        h('p', { class: 'hint' }, 'Video stays on this device. Only numbers are read from each frame.'),
      ),
    ),
  );

  let destroyed = false;
  /** Bumped on every (re)start so an older frame loop knows to stop. */
  let runId = 0;
  let stream: MediaStream | null = null;
  let wakeLock: WakeLockSentinel | null = null;

  const setStatus = (text: string, kind: 'info' | 'ok' | 'error' = 'info') => {
    status.textContent = text;
    status.dataset.kind = kind;
    status.hidden = kind === 'ok';
  };

  const requestWakeLock = async () => {
    // Keep the screen awake while scanning (supported on iOS 16.4+, Chrome, Edge).
    wakeLock = (await navigator.wakeLock?.request('screen').catch(() => null)) ?? null;
  };

  async function start(): Promise<void> {
    const id = ++runId;
    retry.hidden = true;
    stopStream(stream);
    stream = null;
    const stale = () => destroyed || id !== runId;
    try {
      setStatus('Starting camera…');
      // Camera and tracker start together; the tracker download is the slow part on first use.
      const tracker = getFaceLandmarker();
      let trackerLoaded = false;
      void tracker.then(() => (trackerLoaded = true), () => {});

      const opened = await openFrontCamera(video);
      if (stale()) return stopStream(opened);
      stream = opened;
      opened.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (stale()) return;
        setStatus('The camera stopped.', 'error');
        retry.hidden = false;
      });
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
      void requestWakeLock();

      if (!trackerLoaded) setStatus('Loading face tracker…');
      const loaded = await tracker.catch((err: unknown) => {
        throw new Error('The face tracker could not load. Check your internet connection and try again.', { cause: err });
      });
      if (stale()) return;
      engine.value.textContent = `MediaPipe · ${loaded.delegate}`;

      setStatus('Looking for a face…');
      run(id, loaded.landmarker);
    } catch (err) {
      if (stale()) return;
      console.error(err);
      setStatus(err instanceof Error ? err.message : 'Something went wrong.', 'error');
      retry.hidden = false;
    }
  }

  function run(id: number, landmarker: FaceLandmarker): void {
    const ctx = overlay.getContext('2d')!;
    const draw = new DrawingUtils(ctx);
    const FL = FaceLandmarker;
    let lastVideoTime = -1;
    let frames = 0;
    let detectMsTotal = 0;
    let windowStart = performance.now();
    let lastHud = 0;
    let latest: FaceLandmarkerResult | null = null;

    const step = () => {
      if (destroyed || id !== runId) return;
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const t0 = performance.now();
        latest = landmarker.detectForVideo(video, t0);
        detectMsTotal += performance.now() - t0;
        frames++;
        drawOverlay(latest);
      }

      const now = performance.now();
      if (now - windowStart >= 1000) {
        const fps = (frames * 1000) / (now - windowStart);
        speed.value.textContent = frames ? `${fps.toFixed(0)} fps · ${(detectMsTotal / frames).toFixed(1)} ms/frame` : '–';
        frames = 0;
        detectMsTotal = 0;
        windowStart = now;
      }
      // DOM updates ~8×/s are plenty and keep phones cool.
      if (now - lastHud > 125) {
        lastHud = now;
        updateHud(latest);
      }
      schedule();
    };

    const schedule = () => {
      if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(step);
      else requestAnimationFrame(step);
    };

    const drawOverlay = (result: FaceLandmarkerResult) => {
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      const face = result.faceLandmarks[0];
      if (!face) return;
      const scale = overlay.width / 640;
      if (meshToggle.checked) {
        draw.drawConnectors(face, FL.FACE_LANDMARKS_TESSELATION, { color: 'rgba(255,255,255,0.22)', lineWidth: 0.6 * scale });
      }
      for (const set of [FL.FACE_LANDMARKS_FACE_OVAL, FL.FACE_LANDMARKS_LIPS, FL.FACE_LANDMARKS_LEFT_EYE,
        FL.FACE_LANDMARKS_RIGHT_EYE, FL.FACE_LANDMARKS_LEFT_EYEBROW, FL.FACE_LANDMARKS_RIGHT_EYEBROW]) {
        draw.drawConnectors(face, set, { color: '#ff8e6e', lineWidth: 1.6 * scale });
      }
      for (const set of [FL.FACE_LANDMARKS_LEFT_IRIS, FL.FACE_LANDMARKS_RIGHT_IRIS]) {
        draw.drawConnectors(face, set, { color: '#3fe0cf', lineWidth: 1.6 * scale });
      }
    };

    const updateHud = (result: FaceLandmarkerResult | null) => {
      const found = !!result?.faceLandmarks[0];
      if (found) setStatus('', 'ok');
      else if (status.dataset.kind !== 'error') setStatus('Looking for a face…');

      const matrix = result?.facialTransformationMatrixes?.[0];
      if (found && matrix) {
        const p = headPoseFromMatrix(matrix);
        pose.value.textContent = `yaw ${fmt(p.yaw)}° · pitch ${fmt(p.pitch)}° · roll ${fmt(p.roll)}°`;
      } else {
        pose.value.textContent = '–';
      }

      const categories = result?.faceBlendshapes?.[0]?.categories;
      if (found && categories) {
        const map = blendshapeMap(categories);
        const check = checkNeutral(map);
        neutral.value.textContent = check.neutral ? 'Yes ✓' : `Relax (${check.offenders[0]})`;
        neutral.value.dataset.ok = String(check.neutral);

        const top = categories.filter((c) => c.categoryName !== '_neutral').sort((a, b) => b.score - a.score).slice(0, 5);
        shapes.replaceChildren(
          ...top.map((c) =>
            h(
              'li',
              {},
              h('span', { class: 'shape-name' }, c.categoryName),
              h('span', { class: 'bar' }, h('span', { style: `width:${(c.score * 100).toFixed(0)}%` })),
            ),
          ),
        );
      } else {
        neutral.value.textContent = '–';
        delete neutral.value.dataset.ok;
        shapes.replaceChildren();
      }
    };

    schedule();
  }

  const onVisible = () => {
    if (document.visibilityState !== 'visible' || !stream) return;
    // iOS pauses the video and drops the wake lock when the app goes to the background.
    if (video.paused) void video.play();
    void requestWakeLock();
  };
  document.addEventListener('visibilitychange', onVisible);
  retry.addEventListener('click', () => void start());

  void start();

  return {
    el,
    framing: null,
    destroy() {
      destroyed = true;
      document.removeEventListener('visibilitychange', onVisible);
      stopStream(stream);
      video.srcObject = null;
      void wakeLock?.release();
    },
  };
}

function fmt(deg: number): string {
  const n = Math.round(deg);
  return (n > 0 ? '+' : '') + n;
}
