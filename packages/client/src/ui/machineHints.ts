import type { MachineKind } from '@hht/shared';
import type { Actions } from '../input/actions.ts';
import type { ProfileStore } from '../profile/guestProfile.ts';
import { learnedMachine, type ConfirmedFeedback } from '../game/gameplayFeedback.ts';

type Device = Actions['lastDevice'];

const DESCRIBE: Record<MachineKind, string> = {
  excavator: 'Scoop at the pit, then carry dirt to the spoil heap and dump.',
  forklift: 'Load at a supply rack. Drive to your plot or mixer hopper to unload. Steer while stopped to turn on the spot.',
  crane: 'Swing and move the hook out/in. Grab from the striped pad; release over a lit slot.',
  mixer: 'Drop cement bags into the hopper, then mix them into concrete buckets.',
};

export function controlLabels(device: Device): { move: string; action: string; exit: string; camera: string } {
  if (device === 'touch') return { move: 'Stick', action: 'Action', exit: 'Get out', camera: 'Camera' };
  if (device === 'gamepad') return { move: 'Left stick', action: 'X / Square', exit: 'A / Cross', camera: 'B / Circle' };
  return { move: 'W A S D', action: 'E', exit: 'Space', camera: 'Q' };
}

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
 * Machine control help:
 * - the help card (onboarding 004): stays until the player's own confirmed productive work with that
 *   machine (`completedMachineHints`) or an explicit "Got it", follows the active input device, and can
 *   be reopened on request; legacy `seenMachineHints` does not count as learned;
 * - the control bar (003): a one-line key summary at the bottom of the screen the whole time the player
 *   is in a machine (keyboard or gamepad keys, following the last used device; hidden on touch).
 */
export class MachineHints {
  private readonly el: HTMLDivElement;
  private readonly text: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private device: Device = 'keyboard';
  private readonly dismissed = new Set<MachineKind>();
  shownKind: MachineKind | null = null;
  private barKind: MachineKind | null = null;
  private barDevice: Device | null = null;

  constructor(root: HTMLElement, private readonly profile: ProfileStore) {
    this.el = document.createElement('div');
    this.el.className = 'machine-hint hidden';
    this.el.dataset.testid = 'machine-hint';
    this.text = document.createElement('div');
    const dismiss = document.createElement('button');
    dismiss.textContent = 'Got it';
    dismiss.onclick = () => {
      if (this.shownKind) this.dismissed.add(this.shownKind);
      this.hide();
    };
    this.el.append(this.text, dismiss);
    root.appendChild(this.el);
    this.bar = document.createElement('div');
    this.bar.className = 'machine-bar hidden';
    this.bar.dataset.testid = 'machine-bar';
    root.appendChild(this.bar);
  }

  /** On entering: the control bar always; the help card unless learned, dismissed or hidden (or `force`). */
  onEnter(kind: MachineKind, force = false): void {
    if (!force) {
      this.barKind = kind;
      this.barDevice = null; // re-rendered on the next update()
    }
    const prof = this.profile.get();
    if (!force && (prof.guidanceHidden || this.dismissed.has(kind) || prof.completedMachineHints?.includes(kind))) return;
    this.shownKind = kind;
    this.render();
    this.el.classList.remove('hidden');
  }

  /** Per frame: keeps the card and the bar on the last used device. */
  update(device: Device): void {
    if (device !== this.device) {
      this.device = device;
      this.render();
    }
    if (this.barKind && device !== this.barDevice) {
      this.barDevice = device;
      if (device === 'touch') this.bar.classList.add('hidden');
      else {
        this.bar.innerHTML = controlBarHtml(this.barKind, device);
        this.bar.classList.remove('hidden');
      }
    }
  }

  /** A confirmed, attributed productive outcome teaches that machine and closes its card. */
  confirmed(e: ConfirmedFeedback, me: string): void {
    const kind = learnedMachine(e, me);
    if (!kind) return;
    const completed = this.profile.get().completedMachineHints ?? [];
    if (!completed.includes(kind)) this.profile.update({ completedMachineHints: [...completed, kind] });
    if (this.shownKind === kind) this.hide();
  }

  private render(): void {
    if (!this.shownKind) return;
    const labels = controlLabels(this.device);
    this.text.textContent = `${this.shownKind[0]!.toUpperCase()}${this.shownKind.slice(1)} · ${labels.move} move · ${labels.action} action · ${labels.exit} get out · ${labels.camera} camera. ${DESCRIBE[this.shownKind]}`;
  }

  /** Hides the help card (the bar stays while seated). */
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
