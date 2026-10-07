// Loads MediaPipe Face Landmarker once and shares it between screens.

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM_BASE = `${import.meta.env.BASE_URL}mediapipe/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export type Delegate = 'GPU' | 'CPU';

export interface LoadedLandmarker {
  landmarker: FaceLandmarker;
  delegate: Delegate;
}

let loading: Promise<LoadedLandmarker> | null = null;

/** `?delegate=cpu` in the URL forces CPU mode, for comparing speed on a device. */
function preferredDelegate(): Delegate {
  return new URLSearchParams(location.search).get('delegate')?.toUpperCase() === 'CPU' ? 'CPU' : 'GPU';
}

async function create(delegate: Delegate): Promise<LoadedLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
  return { landmarker, delegate };
}

export function getFaceLandmarker(): Promise<LoadedLandmarker> {
  loading ??= (async () => {
    const delegate = preferredDelegate();
    try {
      return await create(delegate);
    } catch (err) {
      if (delegate === 'CPU') throw err;
      console.warn('GPU face tracking unavailable, falling back to CPU', err);
      return create('CPU');
    }
  })();
  // Allow a retry after a failed load (e.g. offline the first time).
  loading.catch(() => (loading = null));
  return loading;
}
