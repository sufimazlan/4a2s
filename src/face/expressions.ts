// How each expression the player is asked to make is recognised from
// MediaPipe's blendshapes. Strength is 0..1; the game snaps the expression
// once strength passes the threshold and is held steady.

import type { Blendshapes } from './analysis';
import type { ExpressionName } from './profile';

export interface ExpressionGuide {
  emoji: string;
  title: string;
  hint: string;
  /** Strength needed to snap. Angry and sad are hard to act on demand, so they are lenient. */
  threshold: number;
  strength(b: Blendshapes): number;
}

const avg = (b: Blendshapes, ...names: string[]) => names.reduce((s, n) => s + (b[n] ?? 0), 0) / names.length;
const upTo = (value: number, full: number) => Math.min(1, Math.max(0, value / full));

export const EXPRESSION_GUIDES: Record<ExpressionName, ExpressionGuide> = {
  smile: {
    emoji: '😊',
    title: 'Smile',
    hint: 'Give a big smile, mouth closed or just a little open.',
    threshold: 0.55,
    strength: (b) => avg(b, 'mouthSmileLeft', 'mouthSmileRight') * ((b.jawOpen ?? 0) > 0.35 ? 0.6 : 1),
  },
  laugh: {
    emoji: '😆',
    title: 'Laugh',
    hint: 'Laugh with your mouth open, like you just heard a great joke.',
    threshold: 0.85,
    strength: (b) => upTo(avg(b, 'mouthSmileLeft', 'mouthSmileRight'), 0.45) * upTo(b.jawOpen ?? 0, 0.3),
  },
  surprised: {
    emoji: '😮',
    title: 'Surprised',
    hint: 'Raise your eyebrows high and drop your jaw.',
    threshold: 0.7,
    strength: (b) =>
      ((upTo(b.browInnerUp ?? 0, 0.5) + upTo(b.jawOpen ?? 0, 0.3) + upTo(avg(b, 'eyeWideLeft', 'eyeWideRight'), 0.3)) / 3) *
      (avg(b, 'mouthSmileLeft', 'mouthSmileRight') > 0.4 ? 0.6 : 1),
  },
  angry: {
    emoji: '😠',
    title: 'Angry',
    hint: 'Frown hard: pull your eyebrows down and together.',
    threshold: 0.6,
    strength: (b) =>
      upTo(avg(b, 'browDownLeft', 'browDownRight'), 0.45) * 0.7 +
      upTo(Math.max(avg(b, 'noseSneerLeft', 'noseSneerRight'), avg(b, 'mouthPressLeft', 'mouthPressRight')), 0.35) * 0.3,
  },
  sad: {
    emoji: '😢',
    title: 'Sad',
    hint: 'Pull the corners of your mouth down and lift the inner eyebrows.',
    threshold: 0.55,
    strength: (b) =>
      (upTo(avg(b, 'mouthFrownLeft', 'mouthFrownRight'), 0.3) * 0.6 + upTo(b.browInnerUp ?? 0, 0.35) * 0.4) *
      (avg(b, 'mouthSmileLeft', 'mouthSmileRight') > 0.3 ? 0.5 : 1),
  },
};
