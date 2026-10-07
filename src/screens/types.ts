import type { Framing } from '../scene/stage';

export interface Screen {
  el: HTMLElement;
  /** Show the 3D stage behind this screen, framed this way. `null` pauses the stage. */
  framing: Framing | null;
  destroy?(): void;
}
