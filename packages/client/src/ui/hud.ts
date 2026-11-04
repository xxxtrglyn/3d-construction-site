import * as THREE from 'three';
import { PIECE_TYPES, type PieceTypeId } from '@hht/shared';
import { PALETTE } from '../render/palette.gen.ts';
import './hud.css';
import './net.css';

const PIECE_COLOR: Record<PieceTypeId, string> = {
  beam: 'beam', brick: 'brick', panel: 'teal', paint: 'purple', decor: 'pink', bell: 'gold', cone: 'orange', cement: 'concrete', concrete: 'stone',
};

const css = (rgb: readonly number[] | undefined): string =>
  rgb ? `rgb(${Math.round((rgb[0] ?? 0) * 255)}, ${Math.round((rgb[1] ?? 0) * 255)}, ${Math.round((rgb[2] ?? 0) * 255)})` : '#ccc';

export interface MenuHandlers {
  onShuffleName(): string;
  onToggleMute(): boolean;
  onRespawn(): void;
  onBuildAgain(): void;
  onOpen(open: boolean): void;
}

/** DOM overlay: name tag, needed-piece badge, hint arrow, toasts, stage panel, menu, celebration. */
export class Hud {
  private readonly nameTag: HTMLDivElement;
  private readonly need: HTMLDivElement;
  private readonly arrow: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly menu: HTMLDivElement;
  private readonly menuWho: HTMLDivElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly celebrate: HTMLDivElement;
  private readonly fps: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private promptText = '';
  private toastTimer = 0;
  private readonly v = new THREE.Vector3();
  menuOpen = false;

  constructor(private readonly root: HTMLElement, handlers: MenuHandlers, muted: boolean) {
    const div = (cls: string, parent: HTMLElement = root): HTMLDivElement => {
      const d = document.createElement('div');
      d.className = cls;
      parent.appendChild(d);
      return d;
    };
    const btn = (label: string, parent: HTMLElement, onClick: () => void, aria?: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = 'hud-btn';
      b.textContent = label;
      if (aria) b.setAttribute('aria-label', aria);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
      });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      parent.appendChild(b);
      return b;
    };
    this.nameTag = div('hud-name');
    this.need = div('hud-need');
    this.arrow = div('hud-arrow');
    this.arrow.style.display = 'none';
    this.toast = div('hud-toast hidden');
    this.stage = div('hud-stage');
    const top = div('hud-top');
    btn('☰', top, () => this.setMenu(!this.menuOpen), 'Menu');
    this.muteBtn = btn(muted ? '🔇' : '🔊', top, () => {
      this.muteBtn.textContent = handlers.onToggleMute() ? '🔇' : '🔊';
    }, 'Toggle sound');
    this.menu = div('hud-menu hidden');
    const panel = div('panel', this.menu);
    const h = document.createElement('h2');
    h.textContent = 'Hard Hat Town';
    panel.appendChild(h);
    this.menuWho = div('who', panel);
    btn('🎲  New name', panel, () => {
      this.menuWho.textContent = `You are ${handlers.onShuffleName()}`;
    });
    btn('🏠  Back to spawn', panel, () => {
      handlers.onRespawn();
      this.setMenu(false);
    });
    btn('🔁  Build again', panel, () => {
      handlers.onBuildAgain();
      this.setMenu(false);
    });
    btn('▶  Keep playing', panel, () => this.setMenu(false));
    this.menu.addEventListener('pointerdown', (e) => {
      if (e.target === this.menu) this.setMenu(false);
    });
    this.onMenu = handlers.onOpen;
    this.celebrate = div('hud-celebrate hidden');
    const title = div('title', this.celebrate);
    title.textContent = '★ Masterpiece! ★';
    btn('🔁  Build again', this.celebrate, () => handlers.onBuildAgain());
    this.fps = div('hud-fps');
    this.fps.style.display = 'none';
    this.prompt = div('net-prompt hidden');
  }

  /** feature 003: the action prompt ("Get in the crane", greyed "Move closer to the pit"). */
  setPrompt(text: string | null, key = 'E', disabled = false): void {
    const t = text ? `${key}|${disabled ? 1 : 0}|${text}` : '';
    if (t === this.promptText) return;
    this.promptText = t;
    this.prompt.classList.toggle('hidden', !text);
    this.prompt.classList.toggle('disabled', disabled);
    if (text) this.prompt.innerHTML = `<kbd>${key}</kbd>${text}`;
  }

  /** feature 003: a free-text "what next" line (Groundwork, crane steps). */
  setNeedText(html: string): void {
    this.need.style.visibility = '';
    this.need.innerHTML = `<span>${html}</span>`;
  }

  private onMenu: (open: boolean) => void;

  setMenu(open: boolean, name?: string): void {
    this.menuOpen = open;
    this.menu.classList.toggle('hidden', !open);
    if (name) this.menuWho.textContent = `You are ${name}`;
    this.onMenu(open);
  }

  setWho(name: string): void {
    this.menuWho.textContent = `You are ${name}`;
  }

  private place(el: HTMLElement, world: THREE.Vector3, camera: THREE.Camera, w: number, h: number): boolean {
    this.v.copy(world).project(camera);
    const visible = this.v.z < 1 && this.v.z > -1;
    el.style.display = visible ? '' : 'none';
    if (visible) el.style.transform = `translate(${((this.v.x + 1) / 2) * w}px, ${((1 - this.v.y) / 2) * h}px) translate(-50%, -100%)`;
    return visible;
  }

  setName(name: string): void {
    this.nameTag.textContent = name;
  }

  setNeed(type: PieceTypeId | null, filled: number, total: number): void {
    if (!type) {
      this.need.style.visibility = 'hidden';
      return;
    }
    this.need.style.visibility = '';
    const color = css(PALETTE[PIECE_COLOR[type]]);
    this.need.innerHTML = `<span class="dot" style="background:${color}"></span><span>Needs: ${PIECE_TYPES[type].label}</span><span class="count">${filled}/${total}</span>`;
  }

  setStage(name: string, stars: number, masterpiece: boolean): void {
    const s = '★'.repeat(stars) + '☆'.repeat(5 - stars);
    this.stage.innerHTML = `<div>Clock Tower · ${masterpiece ? 'Masterpiece' : name}</div><div class="stars">${s}</div>`;
  }

  showToast(text: string, seconds = 2.2): void {
    this.toast.textContent = text;
    this.toast.classList.remove('hidden');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.add('hidden'), seconds * 1000);
  }

  setCelebrate(on: boolean): void {
    this.celebrate.classList.toggle('hidden', !on);
  }

  setFps(text: string | null): void {
    this.fps.style.display = text === null ? 'none' : '';
    if (text !== null) this.fps.textContent = text;
  }

  /** Per-frame placement of world-anchored elements. */
  layout(camera: THREE.Camera, head: THREE.Vector3, needAt: THREE.Vector3, arrowAt: THREE.Vector3 | null): void {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    this.place(this.nameTag, head, camera, w, h);
    this.place(this.need, needAt, camera, w, h);
    if (arrowAt) {
      this.arrow.style.display = '';
      this.v.copy(arrowAt).project(camera);
      const vis = this.v.z < 1;
      this.arrow.style.display = vis ? '' : 'none';
      this.arrow.style.left = `${((this.v.x + 1) / 2) * w - 16}px`;
      this.arrow.style.top = `${((1 - this.v.y) / 2) * h - 24}px`;
    } else this.arrow.style.display = 'none';
  }
}
