import './hud.css';
import './net.css';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export function button(label: string, parent: HTMLElement, onClick: () => void, cls = 'hud-btn'): HTMLButtonElement {
  const b = el('button', cls, parent, label);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  return b;
}

export interface ModalHandle {
  close(): void;
  setAction(label: string, enabled: boolean): void;
}

/** A blocking message with one action (version prompt, idle rejoin, disconnected). */
export function showModal(root: HTMLElement, title: string, text: string, action: string, onAction: () => void): ModalHandle {
  const wrap = el('div', 'net-modal', root);
  wrap.setAttribute('role', 'dialog');
  const panel = el('div', 'panel', wrap);
  el('h2', '', panel, title);
  el('p', '', panel, text);
  const btn = button(action, panel, onAction);
  btn.focus();
  return {
    close: () => wrap.remove(),
    setAction(label, enabled) {
      btn.textContent = label;
      btn.disabled = !enabled;
    },
  };
}

export interface SoloBanner {
  setJoinable(v: boolean): void;
}

/** "Playing solo" banner with a "Join others" button that appears when a world is reachable (FR-050). */
export function showSoloBanner(root: HTMLElement, onJoin: () => void): SoloBanner {
  const b = el('div', 'net-banner', root);
  b.dataset.testid = 'solo-banner';
  el('span', '', b, '🧱 Playing solo');
  const join = button('Join others', b, onJoin);
  join.hidden = true;
  join.dataset.testid = 'join-others';
  return { setJoinable: (v) => (join.hidden = !v) };
}
