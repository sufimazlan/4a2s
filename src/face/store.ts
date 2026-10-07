// Keeps the player's face profile on this device (IndexedDB). Nothing is uploaded.

import { VERTEX_COUNT } from './canonicalFace';
import { PROFILE_VERSION, type FaceProfile } from './profile';

const DB_NAME = '4a2s';
const STORE = 'face';
const KEY = 'me';

/** Fired on `window` whenever the player's face changes; `detail.profile` is the new face (or null). */
export const PROFILE_CHANGED = '4a2s:profile-changed';
export type ProfileChangedEvent = CustomEvent<{ profile: FaceProfile | null }>;

/** What's stored: the texture as bytes, because Safari can't keep Blobs in IndexedDB in private browsing. */
type StoredProfile = Omit<FaceProfile, 'texture'> & { texture: ArrayBuffer; textureType: string };

function announce(profile: FaceProfile | null): void {
  window.dispatchEvent(new CustomEvent(PROFILE_CHANGED, { detail: { profile } }));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      // The request's error is the useful one; tx.error is still null while it bubbles.
      tx.onerror = () => reject(req.error ?? tx.error ?? new DOMException('IndexedDB request failed'));
      tx.onabort = () => reject(tx.error ?? new DOMException('IndexedDB transaction aborted', 'AbortError'));
    });
  } finally {
    db.close();
  }
}

export async function loadProfile(): Promise<FaceProfile | null> {
  try {
    const stored = await run<StoredProfile | undefined>('readonly', (s) => s.get(KEY));
    if (!stored || stored.version !== PROFILE_VERSION || stored.shape?.length !== VERTEX_COUNT * 3) return null;
    if (!(stored.texture instanceof ArrayBuffer)) return null;
    const { textureType, ...rest } = stored;
    return { ...rest, texture: new Blob([stored.texture], { type: textureType }) };
  } catch (err) {
    console.warn('Could not read saved face', err);
    return null;
  }
}

/**
 * Save the face on this device and put it on the character. Returns false if the
 * browser refused to store it (the character still wears it until the app closes).
 */
export async function saveProfile(profile: FaceProfile): Promise<boolean> {
  let saved = true;
  try {
    const stored: StoredProfile = { ...profile, texture: await profile.texture.arrayBuffer(), textureType: profile.texture.type };
    await run('readwrite', (s) => s.put(stored, KEY));
    // Ask the browser not to clear it under storage pressure (Safari especially).
    void navigator.storage?.persist?.().catch(() => false);
  } catch (err) {
    console.warn('Could not save face', err);
    saved = false;
  }
  announce(profile);
  return saved;
}

export async function deleteProfile(): Promise<void> {
  await run('readwrite', (s) => s.delete(KEY));
  announce(null);
}
