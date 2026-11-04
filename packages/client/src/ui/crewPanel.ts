import type { JoinMode } from '@hht/shared';
import type { WorldView } from '../net/connection.ts';
import { flagHtml } from './flags.ts';
import { Panel, button } from './panel.ts';

export interface CrewHandlers {
  mode(m: JoinMode): void;
  remove(pid: string): void;
  handover(pid: string): void;
  leave(): void;
}

/** Crew panel at your plot sign (FR-021, FR-026): members, join mode (Host), remove/make Host, leave. */
export class CrewPanel {
  private readonly panel: Panel;
  private readonly h: CrewHandlers;

  constructor(root: HTMLElement, h: CrewHandlers) {
    this.panel = new Panel(root, 'crew-panel');
    this.h = h;
  }

  get isOpen(): boolean {
    return this.panel.isOpen;
  }

  close(): void {
    this.panel.close();
  }

  open(state: WorldView, plot: number, me: string): void {
    const p = state.plots[plot];
    if (!p) return;
    const isHost = p.hostSession === me;
    this.panel.show(`${flagHtml(plot, 20)} Your crew · ${p.crewSize}/8`);
    if (isHost) {
      const seg = document.createElement('div');
      seg.className = 'seg';
      for (const [m, label] of [['ask', '✋ Ask'], ['open', '🟢 Open'], ['solo', '🔒 Solo']] as const) {
        const b = button(label, seg, () => {
          this.h.mode(m);
          for (const x of seg.querySelectorAll('button')) x.classList.remove('on');
          b.classList.add('on');
        });
        b.dataset.testid = `mode-${m}`;
        if (p.joinMode === m) b.classList.add('on');
      }
      this.panel.body.appendChild(seg);
    }
    state.players.forEach((pl, pid) => {
      if (pl.crewPlot !== plot) return;
      const r = this.panel.row(`${pl.crewRole === 'host' ? '👑 ' : ''}${pl.name}${pid === me ? ' (you)' : ''}`, pl.away ? 'away' : undefined);
      if (isHost && pid !== me) {
        button('Make Host', r, () => {
          this.h.handover(pid);
          this.close();
        }).dataset.testid = `handover-${pid}`;
        button('Remove', r, () => {
          this.h.remove(pid);
          r.remove();
        }).dataset.testid = `remove-${pid}`;
      }
    });
    this.panel.wide('🚪  Leave crew', () => {
      this.h.leave();
      this.close();
    }, 'crew-leave');
    this.panel.wide('▶  Close', () => this.close());
  }
}
