import { CLOCK_TOWER, starsOf } from '@hht/shared';
import type { WorldView } from '../net/connection.ts';
import { flagHtml } from './flags.ts';
import { Panel, button } from './panel.ts';

export interface ForemanHandlers {
  start(): void;
  adopt(plot: number): void;
  guide(plot: number): void;
}

/** Foreman dialogue (FR-016): preset buttons only — Start a building, Who's hiring?, Unfinished buildings, Bye. */
export class ForemanDialog {
  private readonly panel: Panel;
  private readonly h: ForemanHandlers;
  private state: WorldView | null = null;

  constructor(root: HTMLElement, h: ForemanHandlers) {
    this.panel = new Panel(root, 'foreman-dialog');
    this.h = h;
  }

  get isOpen(): boolean {
    return this.panel.isOpen;
  }

  close(): void {
    this.panel.close();
  }

  open(state: WorldView, inCrew: boolean): void {
    this.state = state;
    this.panel.show('👷‍♂️ Foreman');
    this.panel.text(inCrew ? '“You’re already on a crew — finish that tower first, or leave the crew.”' : '“Welcome to the site! What can I do for you?”');
    if (!inCrew) this.panel.wide('🏗️  Start a building', () => this.blueprints(), 'foreman-start');
    this.panel.wide('📋  Who’s hiring?', () => this.hiring(), 'foreman-hiring');
    const unattended = Array.from(state.plots).some((p) => p.state === 'unattended');
    if (unattended && !inCrew) this.panel.wide('🧱  Unfinished buildings', () => this.unfinished(), 'foreman-unfinished');
    this.panel.wide('👋  Bye', () => this.close(), 'foreman-bye');
  }

  private blueprints(): void {
    this.panel.show('🏗️ Pick a blueprint');
    this.panel.row('🕰️ <b>Clock Tower</b>', `${CLOCK_TOWER.stages.length} stages · ${CLOCK_TOWER.stages.reduce((s, x) => s + x.slotCount, 0)} deliveries · ends in a Masterpiece`);
    this.panel.wide('✅  Let’s build!', () => {
      this.h.start();
      this.close();
    }, 'foreman-build');
    this.panel.wide('↩  Back', () => this.state && this.open(this.state, false));
  }

  private hiring(): void {
    const st = this.state;
    if (!st) return;
    this.panel.show('📋 Who’s hiring?');
    let n = 0;
    Array.from(st.plots).forEach((p, i) => {
      if (p.state !== 'building' || p.joinMode === 'solo' || p.crewSize >= 8 || p.crewSize === 0) return;
      n++;
      const stars = starsOf({ blueprintId: CLOCK_TOWER.id, completedStages: p.completedStages, filledSlots: p.filledSlots });
      const r = this.panel.row(`${flagHtml(i, 16)} ${p.hostName}’s Clock Tower`, `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)} · 👥 ${p.crewSize}/8 · ${p.joinMode === 'open' ? 'Open' : 'Ask to join'}`);
      button('Show me', r, () => {
        this.h.guide(i);
        this.close();
      });
    });
    if (!n) this.panel.text('Nobody is hiring right now — start your own building!');
    this.panel.wide('↩  Back', () => this.open(st, false));
  }

  private unfinished(): void {
    const st = this.state;
    if (!st) return;
    this.panel.show('🧱 Unfinished buildings');
    Array.from(st.plots).forEach((p, i) => {
      if (p.state !== 'unattended') return;
      const r = this.panel.row(`${flagHtml(i, 16)} Clock Tower · stage ${p.completedStages}/6`, `started by ${p.hostName}`);
      const b = button('Adopt', r, () => {
        this.h.adopt(i);
        this.close();
      });
      b.dataset.testid = `adopt-${i}`;
    });
    this.panel.wide('↩  Back', () => this.open(st, false));
  }
}
