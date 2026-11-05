import type { Need } from '@hht/shared';
import { chipsHtml, chipsText } from './needsText.ts';
import { button } from './screens.ts';
import './hud.css';
import './net.css';

export interface NetMenuHandlers {
  onShuffleName(): void;
  onToggleMute(): boolean;
  onRespawn(): void;
  onInvite(): void;
  onPeople(): void;
  onToggleHideChat(): boolean;
  /** feature 003: show the machine control card again ("?") */
  onMachineHelp?(): void;
  onOpen(open: boolean): void;
}

/** Multiplayer HUD shell: menu, player counter, connection chip, toasts and the action prompt. */
export class NetHud {
  readonly root: HTMLElement;
  private readonly chip: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly menu: HTMLDivElement;
  private readonly who: HTMLDivElement;
  private readonly fps: HTMLDivElement;
  private readonly hideChatBtn: HTMLButtonElement;
  private toastTimer = 0;
  private crewNeeds: HTMLDivElement | null = null;
  private crewNeedsHtml = '';
  private chipHtml = '';
  private promptText = '';
  menuOpen = false;
  private readonly handlers: NetMenuHandlers;

  constructor(root: HTMLElement, handlers: NetMenuHandlers, muted: boolean, hideChat: boolean) {
    this.root = root;
    this.handlers = handlers;
    const div = (cls: string, parent: HTMLElement = root): HTMLDivElement => {
      const d = document.createElement('div');
      d.className = cls;
      parent.appendChild(d);
      return d;
    };
    const top = div('hud-top');
    button('☰', top, () => this.setMenu(!this.menuOpen)).setAttribute('aria-label', 'Menu');
    const mute = button(muted ? '🔇' : '🔊', top, () => {
      mute.textContent = handlers.onToggleMute() ? '🔇' : '🔊';
    });
    mute.setAttribute('aria-label', 'Toggle sound');
    this.chip = div('net-chip');
    this.chip.dataset.testid = 'player-count';
    this.toastEl = div('hud-toast hidden');
    this.prompt = div('net-prompt hidden');
    this.menu = div('hud-menu hidden');
    const panel = div('panel', this.menu);
    const h = document.createElement('h2');
    h.textContent = 'Hard Hat Town';
    panel.appendChild(h);
    this.who = div('who', panel);
    button('🎲  New name', panel, () => handlers.onShuffleName());
    button('📨  Invite friends', panel, () => handlers.onInvite());
    button('👥  People here', panel, () => {
      this.setMenu(false);
      handlers.onPeople();
    });
    this.hideChatBtn = button(hideChat ? '💬  Show chat' : '🙈  Hide all chat', panel, () => {
      const hidden = handlers.onToggleHideChat();
      this.hideChatBtn.textContent = hidden ? '💬  Show chat' : '🙈  Hide all chat';
    });
    button('🏠  Back to spawn', panel, () => {
      handlers.onRespawn();
      this.setMenu(false);
    });
    if (handlers.onMachineHelp) {
      button('❓  Machine controls', panel, () => {
        this.setMenu(false);
        handlers.onMachineHelp?.();
      });
    }
    button('▶  Keep playing', panel, () => this.setMenu(false));
    this.menu.addEventListener('pointerdown', (e) => {
      if (e.target === this.menu) this.setMenu(false);
    });
    this.fps = div('hud-fps');
    this.fps.style.display = 'none';
  }

  setMenu(open: boolean): void {
    this.menuOpen = open;
    this.menu.classList.toggle('hidden', !open);
    this.handlers.onOpen(open);
  }

  setWho(name: string, worldId: number): void {
    this.who.textContent = `You are ${name} · Site ${worldId}`;
  }

  setChip(players: number, worldId: number, shaky: boolean, extra = ''): void {
    const html = `👷 <span data-testid="count">${players}</span> here · Site ${worldId}${shaky ? ' · <span class="shaky">Connection is shaky</span>' : ''}${extra}`;
    if (html !== this.chipHtml) {
      this.chip.innerHTML = html;
      this.chipHtml = html;
    }
  }

  /**
   * feature 004 (FR-013): a crew member's own-plot needs, fixed at the top of the screen in multiplayer
   * ("Your tower · Frame: ● Beams 3 · ● Bricks ✓"); null hides it. Re-renders only when the text changes.
   */
  setCrewNeeds(stageName: string | null, needs: readonly Need[] | null, line?: string): void {
    if (!this.crewNeeds) {
      this.crewNeeds = document.createElement('div');
      this.crewNeeds.className = 'hud-crewneeds hidden';
      this.crewNeeds.dataset.testid = 'crew-needs';
      this.root.appendChild(this.crewNeeds);
    }
    const html = !stageName && !line ? '' : `<span class="who">Your tower${stageName ? ` · ${stageName}` : ''}</span>${needs?.length ? `<span class="needs">${chipsHtml(needs)}</span>` : line ? `<span>${line}</span>` : ''}`;
    if (html === this.crewNeedsHtml) return;
    this.crewNeedsHtml = html;
    this.crewNeeds.classList.toggle('hidden', !html);
    this.crewNeeds.innerHTML = html;
    this.crewNeeds.setAttribute('aria-label', needs?.length ? chipsText(needs) : (line ?? ''));
  }

  showToast(text: string, seconds = 2.4): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.add('hidden'), seconds * 1000);
  }

  /** The action prompt; `disabled` greys it out (e.g. "Crew only", "Move closer to the pit"). */
  setPrompt(text: string | null, key = 'E', disabled = false): void {
    const t = text ? `${key}|${disabled ? 1 : 0}|${text}` : '';
    if (t === this.promptText) return;
    this.promptText = t;
    this.prompt.classList.toggle('hidden', !text);
    this.prompt.classList.toggle('disabled', disabled);
    if (text) this.prompt.innerHTML = `<kbd>${key}</kbd>${text}`;
  }

  get promptValue(): string {
    return this.promptText.split('|').slice(2).join('|');
  }

  setFps(text: string | null): void {
    this.fps.style.display = text === null ? 'none' : '';
    if (text !== null) this.fps.textContent = text;
  }
}
