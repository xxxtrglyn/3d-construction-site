import * as THREE from 'three';
import { flagHtml } from '../ui/flags.ts';

export interface LabelEntry {
  key: string;
  x: number;
  y: number;
  z: number;
  name: string;
  /** crew flag index or -1 */
  flag: number;
  host: boolean;
  /** speech bubble text (quick message / chat) */
  bubble: string | null;
  bubbleKind: 'say' | 'chat' | 'emote';
  me: boolean;
  distance: number;
}

interface Slot {
  root: HTMLDivElement;
  bubble: HTMLDivElement;
  tag: HTMLDivElement;
  key: string;
  html: string;
  bubbleText: string;
}

const MAX_LABELS = 24;
const MAX_DIST = 25;

/** Pooled DOM nameplates (name, crew flag, Host crown, speech bubble) for the nearest workers. */
export class LabelLayer {
  private readonly slots: Slot[] = [];
  private readonly v = new THREE.Vector3();
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    for (let i = 0; i < MAX_LABELS; i++) {
      const r = document.createElement('div');
      r.className = 'lbl';
      r.style.display = 'none';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.style.display = 'none';
      const tag = document.createElement('div');
      tag.className = 'tag';
      r.append(bubble, tag);
      root.appendChild(r);
      this.slots.push({ root: r, bubble, tag, key: '', html: '', bubbleText: '' });
    }
  }

  update(camera: THREE.Camera, entries: LabelEntry[]): void {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    const shown = entries.filter((e) => e.me || e.distance <= MAX_DIST || (e.bubble !== null && e.distance <= MAX_DIST * 1.4)).sort((a, b) => a.distance - b.distance).slice(0, MAX_LABELS);
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i] as Slot;
      const e = shown[i];
      if (!e) {
        if (s.root.style.display !== 'none') s.root.style.display = 'none';
        continue;
      }
      this.v.set(e.x, e.y + 1.75, e.z).project(camera);
      if (this.v.z >= 1 || this.v.z <= -1) {
        s.root.style.display = 'none';
        continue;
      }
      s.root.style.display = '';
      s.root.classList.toggle('me', e.me);
      s.root.style.transform = `translate(${((this.v.x + 1) / 2) * w}px, ${((1 - this.v.y) / 2) * h}px) translate(-50%, -100%)`;
      const html = `${e.flag >= 0 ? flagHtml(e.flag, 16) : ''}${e.host ? '<span title="Host">👑</span>' : ''}<span>${escapeHtml(e.name)}</span>`;
      if (s.html !== html) {
        s.tag.innerHTML = html;
        s.html = html;
      }
      const bt = e.bubble ?? '';
      if (s.bubbleText !== bt || s.key !== e.key) {
        s.bubble.textContent = bt;
        s.bubble.className = `bubble ${e.bubbleKind}`;
        s.bubble.style.display = bt ? '' : 'none';
        s.bubbleText = bt;
      }
      s.key = e.key;
    }
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
