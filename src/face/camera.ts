// Front camera access that behaves the same on iPhone Safari, Android Chrome and desktop webcams.

/** Default 640×480 keeps live tracking fast; face capture asks for 1280×720 so the face photo is sharp. */
export async function openFrontCamera(
  video: HTMLVideoElement,
  size: { width: number; height: number } = { width: 640, height: 480 },
): Promise<MediaStream> {
  if (!window.isSecureContext) throw new CameraError('insecure');
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported');

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: size.width },
        height: { ideal: size.height },
        frameRate: { ideal: 30, max: 30 },
      },
    });
  } catch (err) {
    throw CameraError.from(err);
  }

  try {
    // iOS needs all three of these or the video stays black / goes fullscreen.
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth) {
      await new Promise<void>((resolve) => video.addEventListener('loadedmetadata', () => resolve(), { once: true }));
    }
    return stream;
  } catch (err) {
    // e.g. the player left the screen while the camera was warming up: don't leave it running.
    stopStream(stream);
    throw err;
  }
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

type CameraErrorKind = 'insecure' | 'unsupported' | 'denied' | 'not-found' | 'busy' | 'unknown';

export class CameraError extends Error {
  readonly kind: CameraErrorKind;

  constructor(kind: CameraErrorKind, cause?: unknown) {
    super(CAMERA_ERROR_MESSAGES[kind], { cause });
    this.kind = kind;
  }

  static from(err: unknown): CameraError {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return new CameraError('denied', err);
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return new CameraError('not-found', err);
    if (name === 'NotReadableError' || name === 'AbortError') return new CameraError('busy', err);
    return new CameraError('unknown', err);
  }
}

const CAMERA_ERROR_MESSAGES: Record<CameraErrorKind, string> = {
  insecure: 'The camera only works over HTTPS. Open the game from its https:// link.',
  unsupported: 'This browser cannot use the camera. Try Safari on iPhone, or Chrome / Edge on a computer.',
  denied:
    'Camera permission was blocked. Allow camera access for this site in your browser settings ' +
    '(iPhone: Settings → Safari → Camera), then try again.',
  'not-found': 'No front camera was found on this device.',
  busy: 'The camera is being used by another app. Close it and try again.',
  unknown: 'The camera could not be started.',
};
