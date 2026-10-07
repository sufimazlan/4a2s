// Service worker registration, update prompts and "install app" support.
//
// Desktop Chrome/Edge and Android fire `beforeinstallprompt`, so we can show our
// own Install button. iOS Safari never does — players add the app through
// Share → Add to Home Screen, so we show instructions instead.

import { registerSW } from 'virtual:pwa-register';
import { isIOS, isStandalone } from './platform';
import { toast } from './ui';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState = 'installed' | 'available' | 'ios-manual' | 'unavailable';

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

export function installState(): InstallState {
  if (isStandalone()) return 'installed';
  if (deferredPrompt) return 'available';
  if (isIOS) return 'ios-manual';
  return 'unavailable';
}

export function onInstallStateChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) fn();
}

export async function promptInstall(): Promise<void> {
  if (!deferredPrompt) return;
  const event = deferredPrompt;
  deferredPrompt = null;
  await event.prompt();
  await event.userChoice;
  notify();
}

export function initPwa(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });

  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;

  const updateSW = registerSW({
    onNeedRefresh() {
      toast('A new version of 4a2s is ready.', { label: 'Update', onClick: () => void updateSW(true) }, 0);
    },
    onOfflineReady() {
      toast('4a2s is ready to work offline.');
    },
  });
}
