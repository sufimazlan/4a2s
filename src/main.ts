import './styles.css';
import type { FaceProfile } from './face/profile';
import { loadProfile, PROFILE_CHANGED, type ProfileChangedEvent } from './face/store';
import { noteRoute } from './nav';
import { initPwa } from './pwa';
import { Character } from './scene/character';
import { Stage } from './scene/stage';
import { homeScreen } from './screens/home';
import type { Screen } from './screens/types';
import { toast } from './ui';

initPwa();

const app = document.getElementById('app')!;
const stage = Stage.create(document.getElementById('stage')!);
const character = stage ? new Character(stage.pointer) : null;
if (stage && character) stage.add(character.root, (dt, t) => character.update(dt, t));

let hasFace = false;
let faceSaved = false;

/** Put a saved face (or none) on the character. */
async function applyProfile(profile: FaceProfile | null, saved = !!profile): Promise<void> {
  hasFace = !!profile;
  faceSaved = saved;
  try {
    await character?.setProfile(profile);
  } catch (err) {
    console.error('Could not build the character from the saved face', err);
    toast('Your saved face could not be loaded. Try scanning again.');
  }
}

const onHome = () => !location.hash.replace(/^#\/?/, '');

// Hash routes keep the browser / Android back button working without any server config.
const routes: Record<string, () => Screen | Promise<Screen>> = {
  '': () => homeScreen({ stageAvailable: !!stage, character, hasFace, faceSaved }),
  create: async () => (await import('./screens/create')).createScreen(),
  scan: async () => (await import('./screens/scan')).scanScreen(),
};

let current: Screen | null = null;
let currentName: string | null = null;
let navigation = 0;

async function route(): Promise<void> {
  const id = ++navigation;
  const name = location.hash.replace(/^#\/?/, '');
  const make = routes[name] ?? routes[''];
  let next: Screen;
  try {
    next = await make();
  } catch (err) {
    console.error(err);
    toast('That screen could not load. Check your connection and try again.');
    return;
  }
  if (id !== navigation) return next.destroy?.();

  current?.destroy?.();
  current = next;
  noteRoute(currentName, name in routes ? name : '');
  currentName = name in routes ? name : '';
  app.replaceChildren(next.el);
  if (stage) {
    stage.setPaused(next.framing === null);
    if (next.framing) stage.setFraming(next.framing);
  }
}

window.addEventListener('hashchange', () => void route());
window.addEventListener(PROFILE_CHANGED, async (event) => {
  // Use the face from the event: it may not have been storable (e.g. Safari private browsing).
  const { profile, saved } = (event as ProfileChangedEvent).detail;
  await applyProfile(profile, saved);
  // Re-render the home screen so it shows the right buttons.
  if (onHome()) void route();
});

async function boot(): Promise<void> {
  // Load the saved face before the first screen so a returning player sees their own
  // character straight away — but never wait long: Safari's IndexedDB can stall.
  const saved = loadProfile();
  const early = await Promise.race([saved, new Promise<'late'>((r) => setTimeout(() => r('late'), 2000))]);
  if (early !== 'late') await applyProfile(early);
  await route();
  // Start rendering after the first screen is up: compiling shaders blocks the page briefly.
  stage?.start();
  if (early === 'late') {
    await applyProfile(await saved);
    if (onHome()) void route();
  }
}

void boot();
