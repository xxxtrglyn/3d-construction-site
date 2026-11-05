import type { MachineKind } from '@hht/shared';
import type { ProfileStore } from '../profile/guestProfile.ts';

const TEXT: Record<MachineKind, { title: string; lines: string[] }> = {
  excavator: { title: '🚜 Excavator', lines: ['<kbd>W</kbd><kbd>S</kbd> drive · <kbd>A</kbd><kbd>D</kbd> turn', '<kbd>E</kbd> scoop at the pit, then dump on the dirt heap', '<kbd>Q</kbd> follow camera ↔ driver camera · <kbd>Space</kbd> get out'] },
  forklift: { title: '🛻 Forklift', lines: ['<kbd>W</kbd><kbd>S</kbd> drive · <kbd>A</kbd><kbd>D</kbd> steer (turns on the spot when stopped)', '<kbd>E</kbd> load a pallet at a rack, unload at your plot', '<kbd>Q</kbd> follow camera ↔ driver camera · <kbd>Space</kbd> get out'] },
  crane: { title: '🏗️ Tower crane', lines: ['<kbd>A</kbd><kbd>D</kbd> swing · <kbd>W</kbd><kbd>S</kbd> hook out / in', '<kbd>E</kbd> grab or release — the hook goes down and up by itself', '<kbd>Q</kbd> hook camera ↔ cab camera · <kbd>Space</kbd> get out'] },
  mixer: { title: '🥣 Cement mixer', lines: ['Crew members drop cement bags in the hopper (up to 4)', '<kbd>E</kbd> mix: every bag becomes a concrete bucket', '<kbd>Q</kbd> mixer view ↔ free camera · <kbd>Space</kbd> get out'] },
};

type Device = 'keyboard' | 'touch' | 'gamepad';

/** The always-on control bar while seated: [keys, what they do] per machine. Touch hides it (its buttons carry labels). */
const MOVE_LABEL: Record<MachineKind, string> = { crane: 'swing · hook out/in', excavator: 'drive · turn', forklift: 'drive · turn', mixer: '' };
const ACT_LABEL: Record<MachineKind, string> = { crane: 'grab / release', excavator: 'scoop / dump', forklift: 'load / unload', mixer: 'mix' };
const KEYS: Record<Exclude<Device, 'touch'>, { move: string; act: string; cam: string; exit: string }> = {
  keyboard: { move: '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>', act: '<kbd>E</kbd>', cam: '<kbd>Q</kbd>', exit: '<kbd>Space</kbd>' },
  gamepad: { move: '<kbd>L stick</kbd>', act: '<kbd>X</kbd>', cam: '<kbd>B</kbd>', exit: '<kbd>A</kbd>' },
};

export function controlBarHtml(kind: MachineKind, device: Exclude<Device, 'touch'>): string {
  const k = KEYS[device];
  const parts = [
    MOVE_LABEL[kind] ? `${k.move} ${MOVE_LABEL[kind]}` : '',
    `${k.act} ${ACT_LABEL[kind]}`,
    `${k.cam} camera`,
    `${k.exit} get out`,
  ].filter(Boolean);
  return parts.map((p) => `<span>${p}</span>`).join('');
}

/**
 * Machine control help (FR-010):
 * - the first-time card per machine kind: shown for 6 s or until the first input, once per kind per
 *   device (profile `seenMachineHints`), and again on request from the "?" menu;
 * - the control bar: a one-line key summary at the bottom of the screen the whole time the player is in
 *   a machine (keyboard or gamepad keys, following the last used device; hidden on touch).
 */
export class MachineHints {
  private readonly el: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private until = 0;
  shownKind: MachineKind | null = null;
  private barKind: MachineKind | null = null;
  private barDevice: Device | null = null;

  constructor(root: HTMLElement, private readonly profile: ProfileStore) {
    this.el = document.createElement('div');
    this.el.className = 'machine-hint hidden';
    this.el.dataset.testid = 'machine-hint';
    root.appendChild(this.el);
    this.bar = document.createElement('div');
    this.bar.className = 'machine-bar hidden';
    this.bar.dataset.testid = 'machine-bar';
    root.appendChild(this.bar);
  }

  /** On entering: the control bar always; the card if this device has not seen it yet (or `force`). */
  onEnter(kind: MachineKind, force = false): void {
    this.barKind = kind;
    this.barDevice = null; // re-rendered on the next update()
    const seen = this.profile.get().seenMachineHints ?? [];
    if (!force && seen.includes(kind)) return;
    const t = TEXT[kind];
    this.el.innerHTML = `<div class="title">${t.title}</div>${t.lines.map((l) => `<div>${l}</div>`).join('')}`;
    this.el.classList.remove('hidden');
    this.until = performance.now() + 6000;
    this.shownKind = kind;
    if (!seen.includes(kind)) this.profile.update({ seenMachineHints: [...seen, kind] });
  }

  /** Per frame while seated: hides the card after 6 s or on the first machine input; keeps the bar on the last used device. */
  update(input: boolean, device: Device = 'keyboard'): void {
    if (this.barKind && device !== this.barDevice) {
      this.barDevice = device;
      if (device === 'touch') this.bar.classList.add('hidden');
      else {
        this.bar.innerHTML = controlBarHtml(this.barKind, device);
        this.bar.classList.remove('hidden');
      }
    }
    if (!this.shownKind) return;
    if (input && performance.now() > this.until - 5400) this.hide();
    else if (performance.now() > this.until) this.hide();
  }

  /** Hides the first-time card (the bar stays while seated). */
  hide(): void {
    this.el.classList.add('hidden');
    this.shownKind = null;
  }

  /** Getting out: hides the card and the bar. */
  leave(): void {
    this.hide();
    this.bar.classList.add('hidden');
    this.barKind = null;
    this.barDevice = null;
  }

  get visible(): boolean {
    return this.shownKind !== null;
  }
}
