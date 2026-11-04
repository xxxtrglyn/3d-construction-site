import { button } from './screens.ts';
import './net.css';

/** A modal list panel (Foreman dialogue, crew panel, people list…). */
export class Panel {
  readonly wrap: HTMLDivElement;
  readonly body: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private onClose: (() => void) | null = null;

  constructor(root: HTMLElement, testid: string) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'net-panel hidden';
    this.wrap.dataset.testid = testid;
    const panel = document.createElement('div');
    panel.className = 'panel';
    this.title = document.createElement('h2');
    this.body = document.createElement('div');
    this.body.style.display = 'grid';
    this.body.style.gap = '8px';
    panel.append(this.title, this.body);
    this.wrap.appendChild(panel);
    this.wrap.addEventListener('pointerdown', (e) => {
      if (e.target === this.wrap) this.close();
      e.stopPropagation();
    });
    root.appendChild(this.wrap);
  }

  get isOpen(): boolean {
    return !this.wrap.classList.contains('hidden');
  }

  show(titleHtml: string, onClose?: () => void): HTMLDivElement {
    this.title.innerHTML = titleHtml;
    this.body.replaceChildren();
    this.wrap.classList.remove('hidden');
    this.onClose = onClose ?? null;
    return this.body;
  }

  close(): void {
    if (!this.isOpen) return;
    this.wrap.classList.add('hidden');
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  text(t: string, cls = ''): HTMLDivElement {
    const d = document.createElement('div');
    d.className = cls;
    d.style.fontWeight = '700';
    d.textContent = t;
    this.body.appendChild(d);
    return d;
  }

  row(html: string, sub?: string): HTMLDivElement {
    const r = document.createElement('div');
    r.className = 'row';
    const g = document.createElement('div');
    g.className = 'grow';
    g.innerHTML = html + (sub ? `<div class="sub">${sub}</div>` : '');
    r.appendChild(g);
    this.body.appendChild(r);
    return r;
  }

  wide(label: string, onClick: () => void, testid?: string): HTMLButtonElement {
    const b = button(label, this.body, onClick, 'hud-btn wide');
    if (testid) b.dataset.testid = testid;
    return b;
  }
}

export { button };
