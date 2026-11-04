import { EMOTE_IDS, QUICK_MESSAGE_IDS, type EmoteId, type QuickMessageId } from '@hht/shared';
import { Panel, button } from './panel.ts';

export const EMOTE_LABEL: Record<EmoteId, { em: string; label: string }> = {
  wave: { em: '👋', label: 'Wave' },
  cheer: { em: '🙌', label: 'Cheer' },
  dance: { em: '💃', label: 'Dance' },
  point: { em: '👉', label: 'Point' },
  thumbsUp: { em: '👍', label: 'Thumbs up' },
};

export const MESSAGE_LABEL: Record<QuickMessageId, string> = {
  needBricks: 'Need bricks!',
  overHere: 'Over here!',
  thanks: 'Thanks!',
  nice: 'Nice!',
  letsBuild: 'Let’s build!',
  canIJoin: 'Can I join?',
};

/** Talk wheel (FR-040): 5 emotes + 6 preset quick messages, number keys 1–9/0/-. No free text. */
export class TalkWheel {
  private readonly panel: Panel;
  private items: Array<() => void> = [];
  private readonly onEmote: (id: EmoteId) => void;
  private readonly onSay: (id: QuickMessageId) => void;

  constructor(root: HTMLElement, onEmote: (id: EmoteId) => void, onSay: (id: QuickMessageId) => void) {
    this.panel = new Panel(root, 'talk-wheel');
    this.onEmote = onEmote;
    this.onSay = onSay;
  }

  get isOpen(): boolean {
    return this.panel.isOpen;
  }

  toggle(): void {
    if (this.isOpen) this.panel.close();
    else this.open();
  }

  close(): void {
    this.panel.close();
  }

  open(): void {
    const body = this.panel.show('💬 Talk');
    const grid = document.createElement('div');
    grid.className = 'wheel';
    body.appendChild(grid);
    this.items = [];
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'];
    let k = 0;
    for (const id of EMOTE_IDS) {
      const fn = () => {
        this.onEmote(id);
        this.close();
      };
      const b = button('', grid, fn);
      b.innerHTML = `<span class="em">${EMOTE_LABEL[id].em}</span>${EMOTE_LABEL[id].label}<span class="k">${keys[k]}</span>`;
      b.dataset.testid = `emote-${id}`;
      this.items.push(fn);
      k++;
    }
    for (const id of QUICK_MESSAGE_IDS) {
      const fn = () => {
        this.onSay(id);
        this.close();
      };
      const b = button('', grid, fn);
      b.innerHTML = `${MESSAGE_LABEL[id]}<span class="k">${keys[k]}</span>`;
      b.dataset.testid = `say-${id}`;
      this.items.push(fn);
      k++;
    }
  }

  /** Number-key pick while open; returns true when handled. */
  pickKey(key: string): boolean {
    if (!this.isOpen) return false;
    const i = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'].indexOf(key);
    const fn = this.items[i];
    if (!fn) return false;
    fn();
    return true;
  }
}
