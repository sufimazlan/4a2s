import { EXPRESSION_GUIDES } from '../face/expressions';
import { deleteProfile } from '../face/store';
import { deviceReport, isTouch } from '../platform';
import { installState, onInstallStateChange, promptInstall } from '../pwa';
import type { Character } from '../scene/character';
import { h, toast } from '../ui';
import type { Screen } from './types';

export function homeScreen(opts: { stageAvailable: boolean; character: Character | null; hasFace: boolean }): Screen {
  const { character, hasFace } = opts;

  const install = h('div', { class: 'install' });
  const renderInstall = () => {
    install.replaceChildren();
    switch (installState()) {
      case 'available':
        install.append(
          h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => void promptInstall() }, 'Install app'),
        );
        break;
      case 'ios-manual':
        install.append(
          h('p', { class: 'hint' }, 'To install: tap ', h('strong', {}, 'Share'), ' then ', h('strong', {}, 'Add to Home Screen'), '.'),
        );
        break;
      case 'installed':
        install.append(h('p', { class: 'hint ok' }, 'Running as an installed app ✓'));
        break;
      case 'unavailable':
        break;
    }
  };
  renderInstall();
  const unsubscribe = onInstallStateChange(renderInstall);

  const checks = h('ul', { class: 'checks' });
  const renderChecks = () =>
    checks.replaceChildren(
      ...deviceReport().map((r) =>
        h('li', { class: r.ok ? 'ok' : 'bad' }, h('span', {}, r.label), h('span', { class: 'detail' }, r.detail)),
      ),
    );
  renderChecks();

  // Rescan / delete must stay reachable even if 3D isn't available to show the face.
  const faceSection = hasFace ? yourFace(character) : newFace();

  const panel = h(
    'section',
    { class: 'panel home-panel' },
    h('h1', { class: 'logo' }, '4a2s'),
    h('p', { class: 'tagline' }, 'Your face. Your expressions. Your character.'),
    ...faceSection,
    install,
    h(
      'details',
      { class: 'device-check', ontoggle: renderChecks },
      h('summary', {}, 'Device check'),
      checks,
      h('a', { class: 'hint link', href: '#/scan' }, 'Open the face tracking test →'),
    ),
  );

  const el = h(
    'div',
    { class: 'screen home' },
    panel,
    opts.stageAvailable
      ? h('p', { class: 'stage-hint' }, isTouch ? 'Swipe to spin · pinch to zoom' : 'Drag to spin · scroll to zoom')
      : h('p', { class: 'stage-hint bad' }, '3D graphics are not available in this browser.'),
  );

  return { el, framing: 'beside-ui', destroy: unsubscribe };
}

function newFace(): Node[] {
  return [
    h(
      'p',
      { class: 'lead' },
      'Scan your face from a few angles and pull a few faces — smile, laugh, angry, sad — and your character gets your look and your expressions.',
    ),
    h('a', { class: 'btn btn-primary', href: '#/create' }, 'Create my character'),
    h('p', { class: 'hint' }, 'Takes about a minute. Your photos stay on this device.'),
  ];
}

function yourFace(character: Character | null): (Node | null)[] {
  const chip = (label: string, onClick: () => void) =>
    h('button', { class: 'chip', type: 'button', onclick: onClick }, label);
  const chips = character
    ? [
        ...character.expressions.map((name) => {
          const g = EXPRESSION_GUIDES[name];
          return chip(`${g.emoji} ${g.title}`, () => character.play(name));
        }),
        chip('🤭 Giggle', () => character.play('giggle')),
      ]
    : [];
  return [
    h(
      'p',
      { class: 'lead' },
      character ? 'That’s you! Tap an expression to see your character make it.' : 'Your face is saved on this device.',
    ),
    chips.length ? h('div', { class: 'chips' }, ...chips) : null,
    h('a', { class: 'btn btn-secondary', href: '#/create' }, 'Rescan my face'),
    h(
      'button',
      {
        class: 'btn btn-ghost btn-danger',
        type: 'button',
        onclick: async () => {
          if (!confirm('Delete your face from this device? Your character goes back to the default face.')) return;
          try {
            await deleteProfile();
            toast('Your face data was deleted.');
          } catch (err) {
            console.error(err);
            toast('Your face data could not be deleted. Please try again.');
          }
        },
      },
      'Delete my face data',
    ),
  ];
}
