// Tiny DOM helpers — the UI is small enough that a framework isn't worth it yet.

type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      el.className = String(value);
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

export function toast(message: string, action?: { label: string; onClick: () => void }, timeoutMs = 5000): void {
  const container = document.getElementById('toasts');
  if (!container) return;
  const item = h('div', { class: 'toast' }, h('span', {}, message));
  const dismiss = () => item.remove();
  if (action) {
    item.append(
      h('button', {
        class: 'btn btn-small',
        type: 'button',
        onclick: () => {
          dismiss();
          action.onClick();
        },
      }, action.label),
    );
  }
  container.append(item);
  if (timeoutMs > 0) setTimeout(dismiss, timeoutMs);
}
