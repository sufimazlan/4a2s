// Device / browser capability checks, shared by the UI and the device-check panel.

const ua = navigator.userAgent;

/** iPhone, iPod, or iPad (iPadOS reports itself as a Mac, so check touch too). */
export const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);

export const isAndroid = /Android/.test(ua);

/** Primary input is a finger rather than a mouse. */
export const isTouch = window.matchMedia('(pointer: coarse)').matches;

/** Running as an installed app (home screen / desktop install) rather than in a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function hasCameraApi(): boolean {
  return window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
}

let webgl2: boolean | undefined;
export function hasWebGL2(): boolean {
  if (webgl2 === undefined) {
    try {
      webgl2 = !!document.createElement('canvas').getContext('webgl2');
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
}

export interface DeviceReport {
  label: string;
  ok: boolean;
  detail: string;
}

export function deviceReport(): DeviceReport[] {
  return [
    { label: '3D graphics (WebGL 2)', ok: hasWebGL2(), detail: hasWebGL2() ? 'Supported' : 'Not available' },
    {
      label: 'Camera access',
      ok: hasCameraApi(),
      detail: !window.isSecureContext ? 'Needs HTTPS' : hasCameraApi() ? 'Supported' : 'Not available',
    },
    {
      label: 'Installed app mode',
      ok: isStandalone(),
      detail: isStandalone() ? 'Running as an app' : 'Running in a browser tab',
    },
    {
      label: 'Offline support',
      ok: 'serviceWorker' in navigator,
      detail: 'serviceWorker' in navigator ? 'Supported' : 'Not available',
    },
    {
      label: 'Screen',
      ok: true,
      detail: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio.toFixed(1)}x · ${isTouch ? 'touch' : 'mouse'}`,
    },
  ];
}
