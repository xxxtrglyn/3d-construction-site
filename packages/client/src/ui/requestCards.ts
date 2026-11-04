import { button } from './screens.ts';
import './net.css';

interface Card {
  requester: string;
  el: HTMLDivElement;
  ring: HTMLDivElement;
  expiresAt: number;
  total: number;
}

/** Host join-request cards (FR-022): newest on top, 30 s ring, ✔/✖ (keys Y/N, gamepad RB/LB). */
export class RequestCards {
  private readonly stack: HTMLDivElement;
  private readonly cards: Card[] = [];
  private readonly answer: (requester: string, approve: boolean) => void;

  constructor(root: HTMLElement, answer: (requester: string, approve: boolean) => void) {
    this.stack = document.createElement('div');
    this.stack.className = 'req-stack';
    this.stack.dataset.testid = 'request-cards';
    root.appendChild(this.stack);
    this.answer = answer;
  }

  get count(): number {
    return this.cards.length;
  }

  add(requester: string, name: string, hatColor: string, expiresAt: number, serverNow: number): void {
    this.remove(requester);
    const el = document.createElement('div');
    el.className = 'req-card';
    el.dataset.requester = requester;
    el.innerHTML = `<span class="hat" style="background:${hatColor}"></span><span class="grow"></span>`;
    (el.querySelector('.grow') as HTMLElement).textContent = `${name} wants to join`;
    const ring = document.createElement('div');
    ring.className = 'ring';
    el.appendChild(ring);
    const yes = button('✔', el, () => this.respond(requester, true), 'hud-btn yes');
    yes.title = 'Approve (Y)';
    yes.dataset.testid = 'approve';
    const no = button('✖', el, () => this.respond(requester, false), 'hud-btn no');
    no.title = 'Deny (N)';
    no.dataset.testid = 'deny';
    this.stack.prepend(el);
    this.cards.unshift({ requester, el, ring, expiresAt, total: Math.max(1000, expiresAt - serverNow) });
  }

  remove(requester: string): void {
    const i = this.cards.findIndex((c) => c.requester === requester);
    if (i < 0) return;
    (this.cards[i] as Card).el.remove();
    this.cards.splice(i, 1);
  }

  clear(): void {
    for (const c of this.cards) c.el.remove();
    this.cards.length = 0;
  }

  respond(requester: string, approve: boolean): void {
    this.answer(requester, approve);
    this.remove(requester);
  }

  /** Answer the top (newest) card. */
  answerTop(approve: boolean): boolean {
    const c = this.cards[0];
    if (!c) return false;
    this.respond(c.requester, approve);
    return true;
  }

  update(serverNow: number): void {
    for (const c of [...this.cards]) {
      const left = c.expiresAt - serverNow;
      if (left <= 0) {
        this.remove(c.requester);
        continue;
      }
      c.ring.style.setProperty('--p', `${Math.round((left / c.total) * 100)}%`);
      c.ring.textContent = String(Math.ceil(left / 1000));
    }
  }
}
