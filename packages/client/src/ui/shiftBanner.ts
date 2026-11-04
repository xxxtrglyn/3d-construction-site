import type { ServerEvents } from '@hht/shared';
import { showModal } from './screens.ts';
import './net.css';

/** Shift warning toast/countdown chip and the end-of-shift summary card (FR-047, FR-048). */
export class ShiftBanner {
  private readonly chip: HTMLDivElement;
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.chip = document.createElement('div');
    this.chip.className = 'shift-chip hidden';
    this.chip.dataset.testid = 'shift-chip';
    root.appendChild(this.chip);
  }

  update(phase: string, endsAt: number, serverNow: number): void {
    const left = Math.max(0, endsAt - serverNow);
    const show = phase === 'warning' || phase === 'countdown';
    this.chip.classList.toggle('hidden', !show);
    if (!show) return;
    const s = Math.ceil(left / 1000);
    this.chip.textContent = phase === 'countdown' ? `⏱ Shift ends in ${s}s` : `⏱ Shift ends in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  summary(s: ServerEvents['summary']): void {
    const m = showModal(
      this.root,
      '🔔 Shift over — great work!',
      `This site finished ${s.worldTowers} tower${s.worldTowers === 1 ? '' : 's'}. Your crews finished ${s.myCrewTowers}. You delivered ${s.delivered} piece${s.delivered === 1 ? '' : 's'} and donated ${s.donated}.`,
      'Start the new shift',
      () => m.close(),
    );
  }
}
