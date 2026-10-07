import { deviceReport, isTouch } from '../platform';
import { installState, onInstallStateChange, promptInstall } from '../pwa';
import { h } from '../ui';
import type { Screen } from './types';

export function homeScreen(opts: { stageAvailable: boolean }): Screen {
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

  const panel = h(
    'section',
    { class: 'panel home-panel' },
    h('h1', { class: 'logo' }, '4a2s'),
    h('p', { class: 'tagline' }, 'Your face. Your expressions. Your character.'),
    h(
      'p',
      { class: 'lead' },
      'Snap your face from a few angles and pull a few faces — smile, laugh, angry, sad — and your character gets your look and your expressions.',
    ),
    h('a', { class: 'btn btn-primary', href: '#/scan' }, 'Try face tracking'),
    h('p', { class: 'hint' }, 'Early test of the face scanner (Phase 1). Nothing leaves your device.'),
    install,
    h(
      'details',
      { class: 'device-check', ontoggle: renderChecks },
      h('summary', {}, 'Device check'),
      checks,
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

  return {
    el,
    framing: 'beside-ui',
    destroy: unsubscribe,
  };
}
