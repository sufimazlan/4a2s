import './styles.css';
import { initPwa } from './pwa';
import { createPlaceholderCharacter } from './scene/placeholderCharacter';
import { Stage } from './scene/stage';
import { homeScreen } from './screens/home';
import type { Screen } from './screens/types';
import { toast } from './ui';

initPwa();

const app = document.getElementById('app')!;
const stage = Stage.create(document.getElementById('stage')!);
if (stage) {
  const character = createPlaceholderCharacter(stage.pointer);
  stage.add(character.root, character.update);
  stage.start();
}

// Hash routes keep the browser / Android back button working without any server config.
const routes: Record<string, () => Screen | Promise<Screen>> = {
  '': () => homeScreen({ stageAvailable: !!stage }),
  scan: async () => (await import('./screens/scan')).scanScreen(),
};

let current: Screen | null = null;
let navigation = 0;

async function route(): Promise<void> {
  const id = ++navigation;
  const make = routes[location.hash.replace(/^#\/?/, '')] ?? routes[''];
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
  app.replaceChildren(next.el);
  if (stage) {
    stage.setPaused(next.framing === null);
    if (next.framing) stage.setFraming(next.framing);
  }
}

window.addEventListener('hashchange', () => void route());
void route();
