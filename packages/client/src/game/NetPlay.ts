import * as THREE from 'three';
import {
  CHAT, HAT_COLORS, INTERACT, PIECE_TYPES, SITE, isEmoteId, isPieceTypeId,
  type EmoteId, type PieceTypeId, type QuickMessageId, type ServerEvents,
} from '@hht/shared';
import type { CrowdPose } from '../crowd/animation.ts';
import type { NetConnection } from '../net/connection.ts';
import type { WorkerPose } from '../player/workerView.ts';
import { ChatUi, type ChatLine } from '../ui/chat.ts';
import { CrewPanel } from '../ui/crewPanel.ts';
import { ForemanDialog } from '../ui/foremanDialog.ts';
import { PlayerCard } from '../ui/playerCard.ts';
import { RequestCards } from '../ui/requestCards.ts';
import { button } from '../ui/screens.ts';
import { ShiftBanner } from '../ui/shiftBanner.ts';
import { EMOTE_LABEL, MESSAGE_LABEL, TalkWheel } from '../ui/talkWheel.ts';
import { NetGame } from './NetGame.ts';
import { NetWorld } from './netWorld.ts';

type Target =
  | { kind: 'foreman' }
  | { kind: 'sign'; plot: number; mine: boolean }
  | { kind: 'bin'; plot: number }
  | { kind: 'piece'; id: number; type: PieceTypeId; point: THREE.Vector3 }
  | { kind: 'rack'; rack: number; type: PieceTypeId; point: THREE.Vector3 };

const RACK_REACH = 1.9;
const SIGN_REACH = 1.6;
const COS_HALF = Math.cos(THREE.MathUtils.degToRad(INTERACT.pickupConeDeg / 2));

/**
 * The full multiplayer game: the shared building world (pieces, plots, Foreman, crews, bins), the
 * context-sensitive action button (contracts/controls.md), social (emotes, quick messages, chat,
 * mute/hide/report) and shifts. Server-authoritative: every action is an intent the server decides.
 */
export class NetPlay extends NetGame {
  world!: NetWorld;
  foremanDialog!: ForemanDialog;
  requestCards!: RequestCards;
  crewPanel!: CrewPanel;
  talkWheel!: TalkWheel;
  playerCard!: PlayerCard;
  shiftBanner!: ShiftBanner;
  chatUi!: ChatUi;
  private target: Target | null = null;
  private armDrop = false;
  private guide: THREE.Vector3 | null = null;
  private arrow!: HTMLDivElement;
  private readonly emotes = new Map<string, { id: EmoteId; until: number }>();
  private myEmote: { id: EmoteId; until: number } | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly v = new THREE.Vector3();

  override async build(): Promise<void> {
    this.world = new NetWorld(this.assets, this.hudRoot, this.sfx, this.quality.particles, this.quality.tier === 'high');
    this.ctx.scene.add(this.world.group);
    const send = <K extends Parameters<NetConnection['send']>[0]>(t: K, p: Parameters<NetConnection['send']>[1]) => this.conn.send(t, p as never);
    this.foremanDialog = new ForemanDialog(this.hudRoot, {
      start: () => send('foreman', { op: 'start', blueprint: 'clock-tower' }),
      adopt: (plot) => send('foreman', { op: 'adopt', plot }),
      guide: (plot) => this.setGuide(plot),
    });
    this.requestCards = new RequestCards(this.hudRoot, (requester, approve) => send('crew', { op: 'answer', requester, approve }));
    this.crewPanel = new CrewPanel(this.hudRoot, {
      mode: (mode) => send('crew', { op: 'mode', mode }),
      remove: (member) => send('crew', { op: 'remove', member }),
      handover: (to) => send('crew', { op: 'handover', to }),
      leave: () => send('crew', { op: 'leave' }),
    });
    this.talkWheel = new TalkWheel(
      this.hudRoot,
      (id) => {
        send('emote', { id });
        this.myEmote = { id, until: performance.now() + 3000 };
      },
      (id) => send('say', { id }),
    );
    this.playerCard = new PlayerCard(this.hudRoot, {
      isMuted: (pid) => this.muted.has(pid),
      isHidden: (pid) => this.hidden.has(pid),
      setMuted: (pid, v) => (v ? this.muted.add(pid) : this.muted.delete(pid)),
      setHidden: (pid, v) => {
        if (v) this.hidden.add(pid);
        else this.hidden.delete(pid);
        send('hide', { who: pid, hidden: v });
      },
      report: (who) => send('report', { who }),
      remove: (member) => send('crew', { op: 'remove', member }),
      handover: (to) => send('crew', { op: 'handover', to }),
    });
    this.shiftBanner = new ShiftBanner(this.hudRoot);
    this.chatUi = new ChatUi(this.hudRoot, (channel, text) => send('chat', { channel, text }));
    this.chatUi.setHidden(this.profile.get().hideAllChat);
    this.arrow = document.createElement('div');
    this.arrow.className = 'hud-arrow';
    this.arrow.style.display = 'none';
    this.hudRoot.appendChild(this.arrow);
    const side = document.createElement('div');
    side.className = 'side-btns';
    this.hudRoot.appendChild(side);
    const talk = button('💬', side, () => this.talkWheel.toggle());
    talk.setAttribute('aria-label', 'Talk (T)');
    talk.dataset.testid = 'talk-button';
    const chat = button('Aa', side, () => this.chatUi.open());
    chat.setAttribute('aria-label', 'Chat (Enter)');
    chat.dataset.testid = 'chat-button';
    this.events.addEventListener('openPeople', () => this.playerCard.people(this.conn.state, this.me));
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.ctx.renderer.domElement.addEventListener('pointerup', (e) => this.onPick(e));
    await super.build();
  }

  override attach(conn: NetConnection): void {
    super.attach(conn);
    this.requestCards?.clear();
    conn.on('snap', (e) => {
      const d = SITE.plots[e.plot];
      const near = !!d && Math.hypot(d.x - this.position.x, d.z - this.position.z) < 30;
      this.world.onSnap(e, near);
      const mine = this.myPlot() === e.plot;
      if (e.result === 'stageComplete' && mine) this.hud.showToast('★ Stage complete!');
      if (e.result === 'masterpiece' && mine) this.hud.showToast('★ Masterpiece! ★', 4);
      if (e.by === this.me) this.emit('snapped', e);
    });
    conn.on('celebrate', (e) => this.world.onCelebrate(e, this.conn.clock.serverNow()));
    conn.on('hint', (h) => {
      this.sfx.play('wrong');
      if (h.kind === 'wrongPiece') this.hud.showToast(`Needs: ${PIECE_TYPES[h.needed].label}`);
      else if (h.kind === 'binFull') this.hud.showToast('That supply bin is full');
      else this.hud.showToast('Only this crew can build here');
    });
    conn.on('binned', (e) => {
      const d = SITE.plots[e.plot];
      if (d) this.world.puffAt(new THREE.Vector3(d.bin.x, 0.8, d.bin.z), 5);
      if (e.by === this.me) this.hud.showToast('💛 Donated to the crew’s supply bin');
    });
    conn.on('thanks', (e) => {
      const who = this.conn.state.players.get(e.by)?.name ?? 'A crew member';
      this.hud.showToast(`💛 ${who} used your donation — thanks!`);
      this.world.puffAt(this.position.clone().setY(1.8), 8);
    });
    conn.on('foreman', (r) => {
      if (r.result === 'assigned' || r.result === 'adopted') {
        this.setGuide(r.plot);
        this.hud.showToast(r.result === 'assigned' ? 'You’re the Host! Follow the arrow to your plot.' : 'You adopted an unfinished tower — welcome, Host!', 3.5);
        this.sfx.play('click');
      } else if (r.result === 'allPlotsBusy') this.hud.showToast('“All plots are busy right now — try Who’s hiring?”', 3.5);
      else this.hud.showToast('“That one isn’t available.”');
    });
    conn.on('request', (r) => {
      if (r.op === 'incoming') {
        const pl = this.conn.state.players.get(r.requester);
        if (this.hidden.has(r.requester)) return;
        this.requestCards.add(r.requester, r.name, HAT_COLORS[(pl?.hatColor ?? 'yellow') as keyof typeof HAT_COLORS] ?? '#ffcc2e', r.expiresAt, this.conn.clock.serverNow());
        this.sfx.play('click');
      } else this.requestCards.remove(r.requester);
    });
    conn.on('requestResult', (r) => {
      const t: Record<string, string> = {
        joined: '🎉 You joined the crew!',
        pending: 'Asked the Host — waiting for an answer…',
        denied: 'The Host said not this time.',
        expired: 'The Host is busy — try again later.',
        full: 'That crew is full.',
        closed: 'That crew is closed (Solo).',
        busy: 'The Host is busy — try again later.',
        alreadyInCrew: 'You’re already on a crew.',
      };
      if (r.result === 'cooldown') {
        const s = Math.max(1, Math.ceil(((r.retryAt ?? 0) - this.conn.clock.serverNow()) / 1000));
        this.hud.showToast(`You can ask again in ${s}s`);
      } else this.hud.showToast(t[r.result] ?? r.result, 3);
      if (r.result === 'joined') this.guide = null;
    });
    conn.on('crewNotice', (n) => {
      const name = n.who === this.me ? 'You' : (this.conn.state.players.get(n.who)?.name ?? 'Someone');
      if (n.kind === 'newHost') this.hud.showToast(n.who === this.me ? '👑 You’re the Host now!' : `👑 ${name} is the Host now`, 3);
      else if (n.kind === 'removed') this.hud.showToast(n.who === this.me ? 'You were removed from the crew.' : `${name} left the crew`, 3);
      else if (n.kind === 'joined' && n.who !== this.me) this.hud.showToast(`👋 ${name} joined the crew`);
      else if (n.kind === 'left' && n.who !== this.me) this.hud.showToast(`${name} left the crew`);
    });
    conn.on('emote', (e) => {
      if (this.muted.has(e.who)) return;
      const now = performance.now();
      if (e.kind === 'emote' && isEmoteId(e.id)) {
        this.emotes.set(e.who, { id: e.id, until: now + 3000 });
        this.bubbles.set(e.who, { text: EMOTE_LABEL[e.id].em, kind: 'emote', until: now + 3000 });
      } else if (e.kind === 'say') {
        this.bubbles.set(e.who, { text: MESSAGE_LABEL[e.id as QuickMessageId] ?? '', kind: 'say', until: now + 3000 });
      }
    });
    conn.on('shift', (s) => {
      if (s.phase === 'warning') this.hud.showToast('⏱ 5 minutes left in this shift!', 4);
    });
    conn.on('summary', (s) => {
      this.guide = null;
      this.requestCards.clear();
      this.shiftBanner.summary(s);
    });
    conn.on('chat', (m) => this.onChat(m));
    conn.on('chatRefused', (r) => this.chatUi.refused(r.reason, r.unlockAt !== undefined ? r.unlockAt - this.conn.clock.offset : undefined));
    conn.on('chatPaused', () => this.hud.showToast('Your chat is paused until the shift ends. Emotes still work!', 4));
    conn.on('reportResult', (r) => this.hud.showToast(r.result === 'ok' ? 'Thanks — we’ll take a look.' : r.result === 'already' ? 'You already reported them this shift.' : 'Could not report that player.'));
  }

  private onChat(m: ServerEvents['chat']): void {
    const pl = this.conn.state.players.get(m.from);
    const shown = !this.muted.has(m.from) && !this.hidden.has(m.from) && !this.profile.get().hideAllChat;
    const line: ChatLine = { from: m.from, name: pl?.name ?? '?', channel: m.channel, text: m.text, at: m.at, flag: pl?.crewPlot ?? -1, shown };
    this.chatUi.add(line);
    if (shown && m.channel === 'nearby') this.bubbles.set(m.from, { text: m.text, kind: 'chat', until: performance.now() + CHAT.bubbleS * 1000 });
  }

  chatLog(): Array<{ from: string; channel: string; text: string; at: number; shown: boolean }> {
    return this.chatUi.history.map((l) => ({ from: l.from, channel: l.channel, text: l.text, at: l.at, shown: l.shown }));
  }

  private myPlot(): number {
    return this.conn.state.players.get(this.me)?.crewPlot ?? -1;
  }

  private setGuide(plot: number): void {
    const d = SITE.plots[plot];
    if (d) this.guide = new THREE.Vector3(d.sign.x, 3.2, d.sign.z);
  }

  // ---------------------------------------------------------------- input

  private onKey(e: KeyboardEvent): void {
    if (this.chatUi.isOpen) return;
    if (e.target instanceof HTMLInputElement) return;
    if (this.talkWheel.pickKey(e.key)) {
      e.preventDefault();
      return;
    }
    switch (e.code) {
      case 'KeyT':
        this.talkWheel.toggle();
        break;
      case 'Enter':
        e.preventDefault();
        this.actions.releaseAll();
        this.chatUi.open();
        break;
      case 'KeyP':
        if (this.playerCard.isOpen) this.playerCard.close();
        else this.playerCard.people(this.conn.state, this.me);
        break;
      case 'KeyY':
        this.requestCards.answerTop(true);
        break;
      case 'KeyN':
        this.requestCards.answerTop(false);
        break;
      case 'Escape':
        for (const p of [this.foremanDialog, this.crewPanel, this.talkWheel, this.playerCard]) p.close();
        break;
      default:
        return;
    }
  }

  /** Tap/click a worker → player card (raycast on the instanced crowd). */
  private onPick(e: PointerEvent): void {
    if (e.button !== 0 || this.uiCapturesInput()) return;
    const r = this.ctx.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.ctx.camera);
    const hits = this.raycaster.intersectObjects(this.crowd.group.children, false);
    const hit = hits.find((h) => h.instanceId !== undefined);
    if (!hit || hit.instanceId === undefined) return;
    const netId = this.crowd.lastKeys[hit.instanceId];
    let pid: string | null = null;
    this.conn.state.players.forEach((p, id) => {
      if (p.netId === netId) pid = id;
    });
    if (pid) this.playerCard.open(this.conn.state, pid, this.me);
  }

  protected override uiCapturesInput(): boolean {
    return this.chatUi?.isOpen || this.foremanDialog?.isOpen || this.crewPanel?.isOpen || this.talkWheel?.isOpen || this.playerCard?.isOpen || false;
  }

  /** Context-sensitive action button (contracts/controls.md). */
  protected override onAction(held: boolean): boolean {
    const a = this.actions;
    const st = this.conn.state;
    const w = this.predictor.state;
    if (held) {
      this.target = null;
      this.hud.setPrompt('Drop · hold to toss');
      if (a.wasPressed('action')) this.armDrop = true;
      const released = a.releasedAfter('action');
      if (a.wasPressed('toss')) {
        this.toss(1);
        this.armDrop = false;
      } else if (this.armDrop && released !== null) {
        if (released >= INTERACT.tossHoldSeconds) this.toss(Math.min(1, (released - INTERACT.tossHoldSeconds) / 0.6));
        else {
          this.conn.send('drop', {});
          this.sfx.play('drop');
          this.predictor.state.carrying = null;
        }
        this.armDrop = false;
      }
      return true;
    }
    this.armDrop = false;
    this.target = this.findTarget(st, w.x, w.z, w.facing);
    const t = this.target;
    this.hud.setPrompt(t ? this.promptFor(t) : null);
    if (!t || !a.wasPressed('action')) return false;
    switch (t.kind) {
      case 'foreman':
        this.foremanDialog.open(st, this.myPlot() >= 0);
        this.actions.releaseAll();
        break;
      case 'sign':
        if (t.mine) this.crewPanel.open(st, t.plot, this.me);
        else this.conn.send('crew', { op: 'request', plot: t.plot });
        this.actions.releaseAll();
        break;
      case 'bin':
        this.conn.send('grab', { target: { kind: 'bin', plot: t.plot } });
        this.sfx.play('pickup');
        break;
      case 'piece':
        this.conn.send('grab', { target: { kind: 'piece', id: t.id } });
        this.sfx.play('pickup');
        break;
      case 'rack':
        this.conn.send('grab', { target: { kind: 'rack', rack: t.rack } });
        this.sfx.play('pickup');
        break;
    }
    return true;
  }

  private toss(charge: number): void {
    this.conn.send('toss', { charge });
    this.worker.tossed();
    this.sfx.play('toss');
    this.predictor.state.carrying = null;
  }

  private promptFor(t: Target): string {
    switch (t.kind) {
      case 'foreman': return 'Talk to the Foreman';
      case 'sign': return t.mine ? 'Crew' : 'Ask to join';
      case 'bin': return 'Take from bin';
      case 'piece':
      case 'rack': return `Grab ${PIECE_TYPES[t.type].label.toLowerCase()}`;
    }
  }

  private findTarget(st: NetConnection['state'], x: number, z: number, facing: number): Target | null {
    const f = SITE.foreman;
    if (Math.hypot(x - f.x, z - f.z) <= f.talkRadius) return { kind: 'foreman' };
    const myPlot = this.myPlot();
    for (const d of SITE.plots) {
      const p = st.plots[d.index];
      if (!p) continue;
      if (Math.hypot(x - d.sign.x, z - d.sign.z) <= SIGN_REACH && (p.state === 'building' || d.index === myPlot)) return { kind: 'sign', plot: d.index, mine: d.index === myPlot };
      if (d.index === myPlot && p.bin.length && Math.hypot(x - d.bin.x, z - d.bin.z) <= d.bin.radius + 1.0) return { kind: 'bin', plot: d.index };
    }
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    let best: Target | null = null;
    let bestScore = Infinity;
    const consider = (px: number, pz: number, reach: number, bias: number, make: () => Target): void => {
      const dx = px - x;
      const dz = pz - z;
      const d = Math.hypot(dx, dz);
      if (d > reach) return;
      if (d > 0.35 && (dx * fx + dz * fz) / d < COS_HALF) return;
      if (d + bias < bestScore) {
        bestScore = d + bias;
        best = make();
      }
    };
    st.pieces.forEach((p, id) => {
      if (p.state !== 'loose' || !isPieceTypeId(p.type)) return;
      const type = p.type;
      consider(p.x, p.z, INTERACT.pickupRadius, 0, () => ({ kind: 'piece', id: Number(id), type, point: new THREE.Vector3(p.x, p.y, p.z) }));
    });
    for (const r of this.site.racks) consider(r.def.x, r.def.z, RACK_REACH, 0.4, () => ({ kind: 'rack', rack: r.def.index, type: r.def.type, point: r.top.clone() }));
    return best;
  }

  // ---------------------------------------------------------------- per-frame hooks

  protected override drawWorld(_dt: number, _now: number, serverNow: number): void {
    this.world.drawPieces(this.pieceRenderer, this.conn.state, serverNow);
  }

  protected override afterStep(dt: number, _now: number, serverNow: number): void {
    const st = this.conn.state;
    this.world.update(dt, st, this.position, this.ctx.camera, this.myPlot(), this.foremanDialog.isOpen);
    this.requestCards.update(serverNow);
    if (this.myPlot() < 0 || st.players.get(this.me)?.crewRole !== 'host') this.requestCards.clear();
    this.shiftBanner.update(st.shift.phase, st.shift.endsAt, serverNow);
    this.chatUi.update();
    this.chatUi.setCrewAvailable(this.myPlot() >= 0);
    this.chatUi.setHidden(this.profile.get().hideAllChat);
    if (this.foremanDialog.isOpen && Math.hypot(this.position.x - SITE.foreman.x, this.position.z - SITE.foreman.z) > SITE.foreman.talkRadius + 1.5) this.foremanDialog.close();
    this.updateGuide();
  }

  private updateGuide(): void {
    const g = this.guide;
    if (!g || Math.hypot(g.x - this.position.x, g.z - this.position.z) < 3.5) {
      this.guide = null;
      this.arrow.style.display = 'none';
      return;
    }
    const w = this.hudRoot.clientWidth || window.innerWidth;
    const h = this.hudRoot.clientHeight || window.innerHeight;
    this.v.copy(g).project(this.ctx.camera);
    const vis = this.v.z < 1;
    this.arrow.style.display = vis ? '' : 'none';
    const cx = THREE.MathUtils.clamp(((this.v.x + 1) / 2) * w, 24, w - 24);
    const cy = THREE.MathUtils.clamp(((1 - this.v.y) / 2) * h, 60, h - 60);
    this.arrow.style.left = `${cx - 16}px`;
    this.arrow.style.top = `${cy - 24}px`;
  }

  protected override ownPose(hs: number): WorkerPose {
    if (this.myEmote && this.myEmote.until > performance.now() && hs < 0.4) return this.myEmote.id;
    return super.ownPose(hs);
  }

  protected override emotePose(pid: string): CrowdPose {
    const e = this.emotes.get(pid);
    return e && e.until > performance.now() ? e.id : 'wave';
  }
}
