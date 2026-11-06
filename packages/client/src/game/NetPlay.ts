import * as THREE from 'three';
import {
  forkliftLoadCount, forkliftUnloadLabel, selectGuidance,
  CHAT, CLOCK_TOWER, HAT_COLORS, INTERACT, MACHINE, MACHINE_KINDS, PIECE_TYPES, SITE, atPit, atSpoil, entryPoint, groundworkPart, hookPos,
  currentStage, isEmoteId, isPieceTypeId, neededSupplies, needsOf, openSlotRefs, plotOfMachine, rackAtForks, snapTarget,
  type EmoteId, type MachineKind, type PieceTypeId, type QuickMessageId, type ServerEvents, type SlotRef,
} from '@hht/shared';
import { progressOf } from '../net/connection.ts';
import type { SampleId } from '../audio/sfx.ts';
import { GameplayGuide } from '../ui/gameplayGuide.ts';
import { recoveryText, successText } from './gameplayFeedback.ts';
import { controlLabels, MachineHints } from '../ui/machineHints.ts';
import { hintLine } from '../ui/needsText.ts';
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
  | { kind: 'rack'; rack: number; type: PieceTypeId; point: THREE.Vector3 }
  | { kind: 'machine'; id: number; label: string; ok: boolean; reason: string };

const MACHINE_NAME: Record<MachineKind, string> = { crane: 'the crane', excavator: 'the excavator', forklift: 'the forklift', mixer: 'the mixer' };
const PLURAL: Record<PieceTypeId, string> = {
  beam: 'beams', brick: 'bricks', panel: 'panels', paint: 'paint buckets', decor: 'crates', bell: 'bell', cone: 'cones', cement: 'cement bags', concrete: 'buckets',
};
const ENGINE: Record<MachineKind, SampleId> = { crane: 'crane-winch', excavator: 'engine-diesel', forklift: 'forklift-motor', mixer: 'mixer-drum' };
const ACT_SOUND: Partial<Record<ServerEvents['machineAct']['act'], [SampleId, number]>> = {
  scoop: ['scoop-dirt', 1], dump: ['dump-dirt', 1], dumpBack: ['dump-dirt', 0.6], hookGrab: ['hook-clank', 1], hookRelease: ['hydraulic', 0.9],
  palletLoad: ['pallet-clunk', 1], palletUnload: ['pallet-clunk', 0.9], mixStart: ['hydraulic', 0.7], mixDone: ['mix-done', 1],
};

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
  machineHints!: MachineHints;
  gameplayGuide!: GameplayGuide;
  /** the slot a crane release would fill right now (FR-027a) */
  litSlot: SlotRef | null = null;
  private guidanceContext = '';
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
    this.machineHints = new MachineHints(this.hudRoot, this.profile);
    this.gameplayGuide = new GameplayGuide(this.hudRoot, this.profile, () => this.machineHints.onEnter(this.myMachineKind ?? 'excavator', true), () => this.machineHints.hide());
    this.events.addEventListener('machineEntered', (e) => this.machineHints.onEnter((e as CustomEvent<MachineKind>).detail));
    this.events.addEventListener('machineLeft', () => {
      this.machineHints.leave();
      this.touch?.setMachineMode(null);
      this.hud.setPrompt(null);
    });
    this.events.addEventListener('machineHelp', () => this.machineHints.onEnter(this.myMachineKind ?? 'crane', true));
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
    this.machineHints?.hide();
    this.gameplayGuide?.update(null);
    conn.on('closed', () => {
      if (this.conn !== conn) return;
      this.machineHints.hide(); this.gameplayGuide.update(null);
      this.world.cue.group.visible = false; this.world.highSlots.update(0, [], null);
    });
    conn.on('snap', (e) => {
      if (e.plot === this.myPlot()) this.machineHints.confirmed({ ...e, act: 'snap' }, this.me);
      const d = SITE.plots[e.plot];
      const near = !!d && Math.hypot(d.x - this.position.x, d.z - this.position.z) < 30;
      this.world.onSnap(e, near);
      const mine = this.myPlot() === e.plot;
      if (e.result === 'stageComplete' && mine) this.hud.showToast('★ Stage complete!');
      if (e.result === 'masterpiece' && mine) this.hud.showToast('★ Masterpiece! ★', 4);
      if (e.by === this.me) { this.emit('snapped', e); if (e.result === 'snapped') this.hud.showToast(successText('snap')!); }
    });
    conn.on('celebrate', (e) => this.world.onCelebrate(e, this.conn.clock.serverNow()));
    conn.on('hint', (h) => {
      this.sfx.play('wrong');
      // needs refusals use the shared needs text (mixed-material 004); others the recovery guidance (onboarding 004)
      const line = h.kind === 'tooHigh' ? null : hintLine(h, this.myStageName());
      this.hud.showToast(line ?? recoveryText(h.kind, undefined, h.kind === 'groundworkFirst' ? h.part : undefined), 3);
    });
    // feature 003: machines
    conn.on('machineResult', (r) => {
      this.enteringUntil = 0;
      if (r.result === 'entered') this.sfx.playSample('hydraulic', 0.6);
      else {
        this.sfx.play('wrong');
        this.hud.showToast(recoveryText(r.result));
      }
    });
    conn.on('machineExit', (e) => {
      const t: Record<string, string> = {
        idle: 'You hopped out after a minute of rest', leftCrew: 'You left the crew, so you hopped out', disconnect: '', shiftReset: 'Shift over: machines are back in their spots', jump: '',
      };
      if (t[e.reason]) this.hud.showToast(t[e.reason] as string, 2.6);
    });
    conn.on('machineAct', (e) => {
      if (e.plot === this.myPlot()) {
        this.machineHints.confirmed(e, this.me);
        const text = successText(e.act);
        if (e.by === this.me && text) this.hud.showToast(text);
      }
      const s = ACT_SOUND[e.act];
      const pose = this.machinePoses[e.id];
      const d = pose ? Math.hypot(pose.x - this.position.x, pose.z - this.position.z) : 0;
      if (s) this.sfx.playSample(s[0], s[1] * Math.max(0, 1 - d / 35));
      if (e.act === 'dump' && pose) this.world.puffAt(new THREE.Vector3(SITE.machines[e.plot]!.spoil.x, 0.6, SITE.machines[e.plot]!.spoil.z), 8);
      if (e.act === 'mixDone') this.world.puffAt(new THREE.Vector3(SITE.machines[e.plot]!.mixer.chute.x, 0.6, SITE.machines[e.plot]!.mixer.chute.z), 8);
    });
    conn.on('ground', (g) => {
      const mine = this.myPlot() === g.plot;
      const d = SITE.plots[g.plot];
      const near = !!d && Math.hypot(d.x - this.position.x, d.z - this.position.z) < 30;
      if (near && g.poured > 0) this.sfx.playSample('concrete-pour', 0.8);
      if (g.done && mine) {
        this.hud.showToast('★ Groundwork done! The Frame stage is unlocked', 3.5);
        this.sfx.play('stage');
      } else if (mine && g.dug === CLOCK_TOWER.groundwork.scoops && g.poured === 0) this.hud.showToast('The pit is dug! Now pour the footing: use the mixer', 3.2);
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

  /** The current stage name of the player's own tower (hint texts), or null. */
  private myStageName(): string | null {
    const pv = this.conn.state.plots[this.myPlot()];
    return pv && pv.state === 'building' ? (currentStage(progressOf(pv))?.name ?? null) : null;
  }

  /** feature 004 (FR-013): the own-plot needs pill, the same chips as the plot sign. */
  private updateCrewNeeds(): void {
    const pv = this.conn.state.plots[this.myPlot()];
    if (!pv || pv.state !== 'building') return this.hud.setCrewNeeds(null, null);
    const progress = progressOf(pv);
    const part = groundworkPart(progress);
    if (part) return this.hud.setCrewNeeds('Groundwork', null, part === 'dig' ? '🚜 dig the pit: use the excavator' : '🥣 pour the footing: use the mixer');
    this.hud.setCrewNeeds(currentStage(progress)?.name ?? null, needsOf(progress));
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
      this.hud.setPrompt('Drop · hold to toss', controlLabels(this.actions.lastDevice).action);
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
    this.hud.setPrompt(t ? this.promptFor(t) : null, controlLabels(this.actions.lastDevice).action, t?.kind === 'machine' && !t.ok);
    if (!t || !a.wasPressed('action')) return false;
    switch (t.kind) {
      case 'machine':
        if (t.ok) {
          this.conn.send('machine', { op: 'enter', id: t.id });
          this.enteringUntil = performance.now() + 1500;
          this.sfx.play('click');
        } else {
          this.sfx.play('wrong');
          this.hud.showToast(t.reason);
        }
        break;
      case 'foreman':
        this.foremanDialog.open(st, this.myPlot());
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
      case 'machine': return t.label;
      case 'foreman': return 'Talk to the Foreman';
      case 'sign': return t.mine ? 'Crew' : 'Ask to join';
      case 'bin': return 'Take from bin';
      case 'piece':
      case 'rack': return `Grab ${PIECE_TYPES[t.type].label.toLowerCase()}`;
    }
  }

  /** "Get in" (contracts/controls.md, feature 003): the nearest machine whose cab is within 1.5 m. */
  private machineTarget(st: NetConnection['state'], x: number, z: number): Target | null {
    const myPlot = this.myPlot();
    let best: Target | null = null;
    let bd: number = MACHINE.enterRange;
    for (const pose of this.machinePoses) {
      const plot = plotOfMachine(pose.id);
      const e = entryPoint({ ...pose, phase: 'idle', phaseT: 0, load: { kind: 'none' } }, SITE.machines[plot]!);
      const d = Math.hypot(e.x - x, e.z - z);
      if (d > bd) continue;
      bd = d;
      const p = st.plots[plot];
      const kind = pose.kind;
      const op = p ? (Array.from(p.machineOps)[MACHINE_KINDS.indexOf(kind)] ?? '') : '';
      const crew = plot === myPlot && !!p && p.state !== 'free';
      if (!crew) best = { kind: 'machine', id: pose.id, label: 'Crew only', ok: false, reason: 'Crew only' };
      else if (op) best = { kind: 'machine', id: pose.id, label: 'Someone is driving', ok: false, reason: 'Someone is driving' };
      else best = { kind: 'machine', id: pose.id, label: `Get in ${MACHINE_NAME[kind]}`, ok: true, reason: '' };
    }
    return best;
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
    // getting in comes before picking up
    const machine = this.machineTarget(st, x, z);
    if (machine) return machine;
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

  // ---------------------------------------------------------------- machines while seated (feature 003)

  /** The next machine action, named on the prompt and the touch button (contracts/controls.md). */
  machineLabel(): { text: string; disabled: boolean } {
    const mp = this.machinePred;
    if (!mp) return { text: '', disabled: true };
    const s = mp.state;
    const plot = plotOfMachine(s.id);
    const pv = this.conn.state.plots[plot];
    const progress = pv && pv.state === 'building' ? progressOf(pv) : null;
    const spots = SITE.machines[plot]!;
    switch (s.kind) {
      case 'excavator':
        if (s.phase !== 'idle') return { text: s.phase === 'lowering' ? 'Scooping…' : 'Dumping…', disabled: true };
        if (s.load.kind === 'dirt') return atSpoil(s, spots) ? { text: 'Dump', disabled: false } : { text: 'Dump (not the heap)', disabled: false };
        if (!progress || groundworkPart(progress) !== 'dig') return { text: 'The pit is dug', disabled: true };
        return atPit(s, spots) ? { text: 'Scoop', disabled: false } : { text: 'Move closer to the pit', disabled: true };
      case 'forklift': {
        if (s.load.kind === 'pallet') return { text: progress ? forkliftUnloadLabel(s, SITE, plot, progress, pv?.mixerBags ?? 0, (pv?.mixerMixUntil ?? 0) > this.conn.clock.serverNow()) : 'Unload safely on the ground', disabled: false };
        const rack = SITE.racks[rackAtForks(s, SITE)];
        if (!rack) return { text: 'Drive to a rack', disabled: true };
        const n = progress ? forkliftLoadCount(progress, rack.type, pv?.mixerBags ?? 0) : 0;
        const useless = !progress || (!neededSupplies(progress).includes(rack.type) && !(rack.type === 'cement' && groundworkPart(progress)));
        if (n <= 0 && useless) return { text: `${PIECE_TYPES[rack.type].label}: not needed`, disabled: true };
        return n > 0 ? { text: `Load ${n} ${PLURAL[rack.type]}`, disabled: false } : { text: 'Nothing needed', disabled: true };
      }
      case 'crane':
        if (s.phase !== 'idle') return { text: s.phase === 'lowering' ? 'Lowering…' : 'Raising…', disabled: true };
        if (s.load.kind === 'hook') return { text: this.litSlot ? 'Release · it snaps!' : 'Release', disabled: false };
        return { text: 'Grab', disabled: false };
      case 'mixer': {
        const bags = pv?.mixerBags ?? 0;
        if (s.phase === 'working' || (pv?.mixerMixUntil ?? 0) > this.conn.clock.serverNow()) return { text: 'Mixing…', disabled: true };
        return bags > 0 ? { text: `Mix (${bags} bag${bags === 1 ? '' : 's'})`, disabled: false } : { text: 'Add cement bags', disabled: true };
      }
    }
  }

  protected override onMachine(_dt: number, _blocked: boolean): void {
    const l = this.machineLabel();
    this.hud.setPrompt(l.text, controlLabels(this.actions.lastDevice).action, l.disabled);
    this.touch?.setMachineMode({ action: l.text, disabled: l.disabled, toss: 'Camera' });
    this.machineHints.update(this.actions.lastDevice);
  }

  /** The lit ring: where a crane release would snap right now (shared snapTarget, FR-027a). */
  private computeLitSlot(): SlotRef | null {
    const mp = this.machinePred;
    if (!mp || mp.state.kind !== 'crane' || mp.state.load.kind !== 'hook') return null;
    const plot = plotOfMachine(mp.state.id);
    const pv = this.conn.state.plots[plot];
    if (!pv || pv.state !== 'building') return null;
    const spots = SITE.machines[plot]!;
    return snapTarget(hookPos(mp.state, spots), mp.state.load.piece, openSlotRefs(SITE.plots[plot]!, spots, progressOf(pv)));
  }

  /** Engine loops: the own machine, plus up to 3 busy machines within 25 m, quieter with distance (FR-041). */
  private machineSounds(serverNow: number): void {
    const keep = new Set<string>();
    const own = this.seatedId;
    const near = this.machinePoses
      .map((p) => ({ p, d: Math.hypot(p.x - this.position.x, p.z - this.position.z) }))
      .filter(({ p, d }) => p.id !== own && d < 25 && (p.operator || p.phase !== 'idle'))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    for (const { p, d } of near) {
      const mixing = p.kind === 'mixer' && (this.conn.state.plots[plotOfMachine(p.id)]?.mixerMixUntil ?? 0) > serverNow;
      const g = (1 - d / 25) * (p.kind === 'mixer' && !mixing ? 0 : 0.55);
      this.sfx.setLoop(`m${p.id}`, ENGINE[p.kind], g);
      keep.add(`m${p.id}`);
    }
    const mp = this.machinePred;
    if (mp) {
      const s = mp.state;
      const a = this.actions;
      const moving = Math.abs(a.move.x) > 0.1 || Math.abs(a.move.y) > 0.1;
      let g = 0.45;
      if (s.kind === 'crane') g = moving || s.phase !== 'idle' ? 0.7 : 0;
      else if (s.kind === 'mixer') g = s.phase === 'working' ? 0.85 : 0;
      else if (moving) g = 0.85;
      this.sfx.setLoop(`m${s.id}`, ENGINE[s.kind], g, s.kind === 'forklift' ? 0.9 + Math.min(0.4, Math.abs(s.p3) / 16) : 1);
      keep.add(`m${s.id}`);
    }
    this.sfx.pruneLoops(keep);
  }

  // ---------------------------------------------------------------- per-frame hooks

  protected override drawWorld(_dt: number, _now: number, serverNow: number): void {
    this.world.drawPieces(this.pieceRenderer, this.conn.state, serverNow);
  }

  protected override afterStep(dt: number, _now: number, serverNow: number): void {
    const st = this.conn.state;
    this.world.update(dt, st, this.position, this.ctx.camera, this.myPlot(), this.foremanDialog.isOpen);
    this.litSlot = this.computeLitSlot();
    this.world.updateMachines(dt, st, serverNow, this.ctx.camera, this.position, this.myPlot(), this.machinePoses, this.litSlot);
    this.machineSounds(serverNow);
    this.requestCards.update(serverNow);
    if (this.myPlot() < 0 || st.players.get(this.me)?.crewRole !== 'host') this.requestCards.clear();
    this.shiftBanner.update(st.shift.phase, st.shift.endsAt, serverNow);
    this.chatUi.update();
    this.updateCrewNeeds();
    this.chatUi.setCrewAvailable(this.myPlot() >= 0);
    this.chatUi.setHidden(this.profile.get().hideAllChat);
    if (this.foremanDialog.isOpen && Math.hypot(this.position.x - SITE.foreman.x, this.position.z - SITE.foreman.z) > SITE.foreman.talkRadius + 1.5) this.foremanDialog.close();
    this.updateGuide();
    const plot = this.myPlot();
    const context = `${st.shift.epoch}:${plot}`;
    if (context !== this.guidanceContext) { this.guidanceContext = context; this.guide = null; this.arrow.style.display = 'none'; this.machineHints.hide(); this.gameplayGuide.update(null); this.world.clearFeedback(); }
    const pv = st.plots[plot];
    const held = st.players.get(this.me)?.heldType;
    let concreteAvailable = false;
    st.pieces.forEach(p => { const def = SITE.plots[plot]; if (def && p.type === 'concrete' && Math.hypot(p.x - def.x, p.z - def.z) < 10) concreteAvailable = true; });
    const suggestion = selectGuidance({ concreteAvailable, mode: 'multiplayer', connected: this.conn.closedCode === null, hidden: !!this.profile.get().guidanceHidden,
      progress: pv && pv.state !== 'free' ? progressOf(pv) : null, held: isPieceTypeId(held) ? held : null,
      machine: this.machinePred?.state ?? null, occupied: MACHINE_KINDS.filter((_, i) => !!pv?.machineOps[i]),
      mixerBags: pv?.mixerBags ?? 0, mixing: (pv?.mixerMixUntil ?? 0) > serverNow,
      allPlotsBusy: Array.from(st.plots).every(p => p.state !== 'free'),
      donationPlot: Array.from(st.plots).findIndex(p => p.state === 'building' && p.bin.length < 10) });
    this.gameplayGuide.update(suggestion);
    this.gameplayGuide.target(suggestion, SITE, plot, this.ctx.camera, this.position);
    const targetKind = suggestion?.target.kind === 'machine' ? suggestion.target.machine : null;
    this.world.cue.update(0, plot, pv ? progressOf(pv) : null, () => false, kind => {
      const spots = SITE.machines[plot]!;
      const pose = this.machinePoses[plot * 4 + MACHINE_KINDS.indexOf(kind)];
      return kind === 'crane' ? { x: spots.crane.x, z: spots.crane.z, top: spots.crane.cabHeight + .8 } : { x: pose?.x ?? spots.mixer.x, z: pose?.z ?? spots.mixer.z, top: 2.3 };
    }, targetKind);
    if (plot < 0 && this.guide && !this.profile.get().guidanceHidden && this.conn.closedCode === null) {
      this.gameplayGuide.update({ key: 'visit', text: 'Follow the arrow to the crew sign to request to join', target: { kind: 'none' } });
      this.gameplayGuide.target(null, SITE, plot, this.ctx.camera);
    } else this.arrow.style.display = 'none';
    this.machineHints.update(this.actions.lastDevice);
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
