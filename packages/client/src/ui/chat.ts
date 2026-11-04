import { CHAT, type ChatChannel, type ChatRefusal } from '@hht/shared';
import { button } from './screens.ts';
import './net.css';

export interface ChatLine {
  from: string;
  name: string;
  channel: ChatChannel;
  text: string;
  at: number;
  flag: number;
  shown: boolean;
}

const REFUSAL: Record<ChatRefusal, string> = {
  locked: 'Chat unlocks in a moment',
  paused: 'Chat paused for this shift',
  rate: 'Slow down',
  tooLong: 'That message is too long',
  empty: 'Type something first',
  contact: 'Links and contact info aren’t allowed',
  duplicate: 'You just said that',
  noCrew: 'Join a crew to use crew chat',
};

/**
 * Typed chat (US9): the box (≤ 80 chars, Nearby/Crew, Enter sends, Esc closes, Tab switches) and the
 * log (50 lines, Nearby/Crew tabs, session memory only). Bubbles are drawn by the label layer.
 */
export class ChatUi {
  private readonly box: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly chanBtn: HTMLButtonElement;
  private readonly count: HTMLSpanElement;
  private readonly hint: HTMLDivElement;
  private readonly log: HTMLDivElement;
  private readonly lines: HTMLDivElement;
  private readonly tabs: Record<ChatChannel, HTMLButtonElement>;
  private channel: ChatChannel = 'nearby';
  private tab: ChatChannel = 'nearby';
  readonly history: ChatLine[] = [];
  private lastActivity = 0;
  private hintTimer = 0;
  private unlockAt = 0;
  private readonly send: (channel: ChatChannel, text: string) => void;

  constructor(root: HTMLElement, send: (channel: ChatChannel, text: string) => void) {
    this.send = send;
    this.log = document.createElement('div');
    this.log.className = 'chat-log idle';
    this.log.dataset.testid = 'chat-log';
    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    this.tabs = {
      nearby: button('Nearby', tabs, () => this.setTab('nearby'), ''),
      crew: button('Crew', tabs, () => this.setTab('crew'), ''),
    };
    this.lines = document.createElement('div');
    this.lines.className = 'lines';
    this.log.append(tabs, this.lines);
    root.appendChild(this.log);

    this.box = document.createElement('div');
    this.box.className = 'chat-box hidden';
    this.box.dataset.testid = 'chat-box';
    this.hint = document.createElement('div');
    this.hint.className = 'hint';
    this.chanBtn = button('Nearby', this.box, () => this.toggleChannel(), 'hud-btn chan');
    this.input = document.createElement('input');
    this.input.maxLength = CHAT.maxLen;
    this.input.autocomplete = 'off';
    this.input.setAttribute('enterkeyhint', 'send');
    this.input.setAttribute('aria-label', 'Chat message');
    this.input.dataset.testid = 'chat-input';
    this.count = document.createElement('span');
    this.count.className = 'count';
    this.box.append(this.hint, this.input, this.count);
    const sendBtn = button('➤', this.box, () => this.submit(), 'hud-btn');
    sendBtn.setAttribute('aria-label', 'Send');
    root.appendChild(this.box);
    this.input.addEventListener('input', () => (this.count.textContent = `${this.input.value.length}/${CHAT.maxLen}`));
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.toggleChannel();
      }
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    // keep the box above the on-screen keyboard on phones
    window.visualViewport?.addEventListener('resize', () => {
      const vv = window.visualViewport;
      if (!vv) return;
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      this.box.style.bottom = covered > 40 ? `${covered + 8}px` : '';
    });
    this.setTab('nearby');
  }

  get isOpen(): boolean {
    return !this.box.classList.contains('hidden');
  }

  open(): void {
    this.box.classList.remove('hidden');
    this.count.textContent = `${this.input.value.length}/${CHAT.maxLen}`;
    if (this.unlockAt > Date.now()) this.flash(`Chat unlocks in ${Math.ceil((this.unlockAt - Date.now()) / 1000)}s`);
    window.setTimeout(() => this.input.focus(), 0);
  }

  close(): void {
    this.box.classList.add('hidden');
    this.input.blur();
  }

  setCrewAvailable(v: boolean): void {
    if (!v && this.channel === 'crew') this.toggleChannel();
  }

  private toggleChannel(): void {
    this.channel = this.channel === 'nearby' ? 'crew' : 'nearby';
    this.chanBtn.textContent = this.channel === 'nearby' ? 'Nearby' : 'Crew';
  }

  private setTab(t: ChatChannel): void {
    this.tab = t;
    this.tabs.nearby.classList.toggle('on', t === 'nearby');
    this.tabs.crew.classList.toggle('on', t === 'crew');
    this.render();
  }

  private submit(): void {
    const text = this.input.value.trim();
    if (!text) return;
    this.send(this.channel, text);
    this.input.value = '';
    this.count.textContent = `0/${CHAT.maxLen}`;
  }

  flash(text: string): void {
    this.hint.textContent = text;
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => (this.hint.textContent = ''), 3000);
  }

  refused(reason: ChatRefusal, unlockAtLocal?: number): void {
    if (reason === 'locked' && unlockAtLocal) {
      this.unlockAt = unlockAtLocal;
      this.flash(`Chat unlocks in ${Math.max(1, Math.ceil((unlockAtLocal - Date.now()) / 1000))}s`);
      return;
    }
    this.flash(REFUSAL[reason]);
  }

  add(line: ChatLine): void {
    this.history.push(line);
    if (this.history.length > CHAT.logLines) this.history.shift();
    this.lastActivity = performance.now();
    this.render();
  }

  private render(): void {
    const rows = this.history.filter((l) => l.channel === this.tab && l.shown);
    this.lines.replaceChildren(
      ...rows.map((l) => {
        const d = document.createElement('div');
        d.className = 'line';
        const b = document.createElement('b');
        b.textContent = `${l.name}: `;
        d.append(b, document.createTextNode(l.text));
        return d;
      }),
    );
    this.lines.scrollTop = this.lines.scrollHeight;
  }

  update(): void {
    const idle = !this.isOpen && performance.now() - this.lastActivity > 8000;
    this.log.classList.toggle('idle', idle);
  }

  setHidden(hidden: boolean): void {
    this.log.style.display = hidden ? 'none' : '';
  }
}
