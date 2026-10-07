// Keeps the player's face profile on this device (IndexedDB). Nothing is uploaded.

import { VERTEX_COUNT } from './canonicalFace';
import { PROFILE_VERSION, type FaceProfile } from './profile';

const DB_NAME = '4a2s';
const STORE = 'face';
const KEY = 'me';

/** Fired on `window` whenever the player's face changes; `detail.profile` is the new face (or null). */
export const PROFILE_CHANGED = '4a2s:profile-changed';
export type ProfileChangedEvent = CustomEvent<{ profile: FaceProfile | null; saved: boolean }>;

/** What's stored: the texture as bytes, because Safari can't keep Blobs in IndexedDB in private browsing. */
type StoredProfile = Omit<FaceProfile, 'texture'> & { texture: ArrayBuffer; textureType: string };

function announce(profile: FaceProfile | null, saved: boolean): void {
  window.dispatchEvent(new CustomEvent(PROFILE_CHANGED, { detail: { profile, saved } }));
}

/** IndexedDB can stall (Safari); never let it hold up the game for long. */
const STORAGE_TIMEOUT_MS = 4000;
function withTimeout<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Storage timed out')), STORAGE_TIMEOUT_MS)),
  ]);
}

/** Whether the current face is (probably) stored on the device. */
let stored = false;

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
    const record = await run<StoredProfile | undefined>('readonly', (s) => s.get(KEY));
    if (!record || record.version !== PROFILE_VERSION || record.shape?.length !== VERTEX_COUNT * 3) return null;
    if (!(record.texture instanceof ArrayBuffer)) return null;
    stored = true;
    const { textureType, ...rest } = record;
    return { ...rest, texture: new Blob([record.texture], { type: textureType }) };
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
    const record: StoredProfile = { ...profile, texture: await profile.texture.arrayBuffer(), textureType: profile.texture.type };
    await withTimeout(run('readwrite', (s) => s.put(record, KEY)));
    // Ask the browser not to clear it under storage pressure (Safari especially).
    void navigator.storage?.persist?.().catch(() => false);
  } catch (err) {
    console.warn('Could not save face', err);
    saved = false;
  }
  stored = saved;
  announce(profile, saved);
  return saved;
}

/** Remove the face from the character straight away, then from the device. */
export async function deleteProfile(): Promise<void> {
  const hadStored = stored;
  announce(null, false);
  try {
    await withTimeout(run('readwrite', (s) => s.delete(KEY)));
    stored = false;
  } catch (err) {
    // Only a problem if a copy was actually saved; an in-memory-only face is already gone.
    if (hadStored) throw err;
  }
}
