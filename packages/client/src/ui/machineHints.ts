import type { MachineKind } from '@hht/shared';
import type { Actions } from '../input/actions.ts';
import type { ProfileStore } from '../profile/guestProfile.ts';
import { learnedMachine, type ConfirmedFeedback } from '../game/gameplayFeedback.ts';
const DESCRIBE: Record<MachineKind, string> = {
  excavator: 'Scoop at the pit, then carry dirt to the spoil heap and dump.',
  forklift: 'Load at a supply rack. Drive to your plot or mixer hopper to unload.',
  crane: 'Swing and move the hook out/in. Grab from the striped pad; release over a lit slot.',
  mixer: 'Drop cement bags into the hopper, then mix them into concrete buckets.',
};
export function controlLabels(device: Actions['lastDevice']): { move: string; action: string; exit: string; camera: string } {
  if (device === 'touch') return { move: 'Stick', action: 'Action', exit: 'Get out', camera: 'Camera' };
  if (device === 'gamepad') return { move: 'Left stick', action: 'X / Square', exit: 'A / Cross', camera: 'B / Circle' };
  return { move: 'W A S D', action: 'E', exit: 'Space', camera: 'Q' };
}
/** Compact help stays until productive success or explicit dismissal. */
export class MachineHints {
  private readonly el: HTMLDivElement;
  private readonly text: HTMLDivElement;
  private device: Actions['lastDevice'] = 'keyboard';
  private readonly dismissed = new Set<MachineKind>();
  shownKind: MachineKind | null = null;
  constructor(root: HTMLElement, private readonly profile: ProfileStore) {
    this.el = document.createElement('div');
    this.el.className = 'machine-hint hidden';
    this.el.dataset.testid = 'machine-hint';
    this.text = document.createElement('div');
    const dismiss = document.createElement('button');
    dismiss.textContent = 'Got it';
    dismiss.onclick = () => { if (this.shownKind) this.dismissed.add(this.shownKind); this.hide(); };
    this.el.append(this.text, dismiss);
    root.appendChild(this.el);
  }
  onEnter(kind: MachineKind, force = false): void {
    if (!force && (this.profile.get().guidanceHidden || this.dismissed.has(kind) || this.profile.get().completedMachineHints?.includes(kind))) return;
    this.shownKind = kind;
    this.render();
    this.el.classList.remove('hidden');
  }
  update(device: Actions['lastDevice']): void {
    if (device !== this.device) { this.device = device; this.render(); }
  }
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
    this.text.textContent = `${this.shownKind[0]!.toUpperCase()}${this.shownKind.slice(1)} · ${labels.move} move · ${labels.action} action · ${labels.exit} get out${this.shownKind === 'crane' ? ` · ${labels.camera} camera` : ''}. ${DESCRIBE[this.shownKind]}`;
  }
  hide(): void { this.el.classList.add('hidden'); this.shownKind = null; }
  get visible(): boolean { return this.shownKind !== null; }
}
