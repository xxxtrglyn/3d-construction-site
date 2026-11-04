import type { WorldView } from '../net/connection.ts';
import { flagHtml } from './flags.ts';
import { Panel, button } from './panel.ts';

export interface PlayerCardHandlers {
  isMuted(pid: string): boolean;
  isHidden(pid: string): boolean;
  setMuted(pid: string, v: boolean): void;
  setHidden(pid: string, v: boolean): void;
  report(pid: string): void;
  remove(pid: string): void;
  handover(pid: string): void;
}

/** Player card + "People here" list (FR-026, FR-042, FR-065): Mute, Hide, Report chat; Host: Remove, Make Host. */
export class PlayerCard {
  private readonly panel: Panel;
  private readonly h: PlayerCardHandlers;

  constructor(root: HTMLElement, h: PlayerCardHandlers) {
    this.panel = new Panel(root, 'player-card');
    this.h = h;
  }

  get isOpen(): boolean {
    return this.panel.isOpen;
  }

  close(): void {
    this.panel.close();
  }

  open(state: WorldView, pid: string, me: string): void {
    const pl = state.players.get(pid);
    if (!pl || pid === me) return;
    const mine = state.players.get(me);
    const sameCrew = !!mine && mine.crewPlot >= 0 && mine.crewPlot === pl.crewPlot;
    const iAmHost = !!mine && mine.crewRole === 'host';
    this.panel.show(`${pl.crewPlot >= 0 ? flagHtml(pl.crewPlot, 20) : ''} ${pl.name}`);
    const muted = this.h.isMuted(pid);
    this.panel.wide(muted ? '🔈  Unmute' : '🔇  Mute', () => {
      this.h.setMuted(pid, !muted);
      this.open(state, pid, me);
    }, 'card-mute');
    const hidden = this.h.isHidden(pid);
    this.panel.wide(hidden ? '👁  Unhide' : '🙈  Hide', () => {
      this.h.setHidden(pid, !hidden);
      this.open(state, pid, me);
    }, 'card-hide');
    this.panel.wide('🚩  Report chat', () => {
      const b = this.panel.body.querySelector('[data-testid="card-report"]') as HTMLButtonElement | null;
      if (b && b.dataset.confirm !== '1') {
        b.dataset.confirm = '1';
        b.textContent = '🚩  Tap again to report';
        return;
      }
      this.h.report(pid);
      this.close();
    }, 'card-report');
    if (iAmHost && sameCrew) {
      this.panel.wide('🧹  Remove from crew', () => {
        this.h.remove(pid);
        this.close();
      }, 'card-remove');
      this.panel.wide('👑  Make Host', () => {
        this.h.handover(pid);
        this.close();
      }, 'card-handover');
    }
    this.panel.wide('▶  Close', () => this.close());
  }

  people(state: WorldView, me: string): void {
    this.panel.show('👥 People here');
    state.players.forEach((pl, pid) => {
      if (pid === me || pl.away) return;
      const r = this.panel.row(`${pl.crewPlot >= 0 ? flagHtml(pl.crewPlot, 14) + ' ' : ''}${pl.crewRole === 'host' ? '👑 ' : ''}${pl.name}`, [this.h.isMuted(pid) ? 'muted' : '', this.h.isHidden(pid) ? 'hidden' : ''].filter(Boolean).join(' · ') || undefined);
      button('Open', r, () => this.open(state, pid, me));
    });
    this.panel.wide('▶  Close', () => this.close());
  }
}
