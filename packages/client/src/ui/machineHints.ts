import type { MachineKind } from '@hht/shared';
import type { ProfileStore } from '../profile/guestProfile.ts';

const TEXT: Record<MachineKind, { title: string; lines: string[] }> = {
  excavator: { title: '🚜 Excavator', lines: ['<kbd>W</kbd><kbd>S</kbd> drive · <kbd>A</kbd><kbd>D</kbd> turn', '<kbd>E</kbd> scoop at the pit, then dump on the dirt heap', '<kbd>Space</kbd> get out'] },
  forklift: { title: '🛻 Forklift', lines: ['<kbd>W</kbd><kbd>S</kbd> drive · <kbd>A</kbd><kbd>D</kbd> steer', '<kbd>E</kbd> load a pallet at a rack, unload at your plot', '<kbd>Space</kbd> get out'] },
  crane: { title: '🏗️ Tower crane', lines: ['<kbd>A</kbd><kbd>D</kbd> swing · <kbd>W</kbd><kbd>S</kbd> hook out / in', '<kbd>E</kbd> grab or release — the hook goes down and up by itself', '<kbd>Q</kbd> hook camera ↔ cab camera · <kbd>Space</kbd> get out'] },
  mixer: { title: '🥣 Cement mixer', lines: ['Crew members drop cement bags in the hopper (up to 4)', '<kbd>E</kbd> mix: every bag becomes a concrete bucket', '<kbd>Space</kbd> get out'] },
};

/**
 * First-time control hint per machine kind (FR-010): shown for 6 s or until the first input, once per
 * kind per device (profile `seenMachineHints`), and again on request from the "?" menu.
 */
export class MachineHints {
  private readonly el: HTMLDivElement;
  private until = 0;
  shownKind: MachineKind | null = null;

  constructor(root: HTMLElement, private readonly profile: ProfileStore) {
    this.el = document.createElement('div');
    this.el.className = 'machine-hint hidden';
    this.el.dataset.testid = 'machine-hint';
    root.appendChild(this.el);
  }

  /** On entering: show the card if this device has not seen it yet (or `force`). */
  onEnter(kind: MachineKind, force = false): void {
    const seen = this.profile.get().seenMachineHints ?? [];
    if (!force && seen.includes(kind)) return;
    const t = TEXT[kind];
    this.el.innerHTML = `<div class="title">${t.title}</div>${t.lines.map((l) => `<div>${l}</div>`).join('')}`;
    this.el.classList.remove('hidden');
    this.until = performance.now() + 6000;
    this.shownKind = kind;
    if (!seen.includes(kind)) this.profile.update({ seenMachineHints: [...seen, kind] });
  }

  /** Per frame: hides after 6 s or on the first machine input. */
  update(input: boolean): void {
    if (!this.shownKind) return;
    if (input && performance.now() > this.until - 5400) this.hide();
    else if (performance.now() > this.until) this.hide();
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.shownKind = null;
  }

  get visible(): boolean {
    return this.shownKind !== null;
  }
}
