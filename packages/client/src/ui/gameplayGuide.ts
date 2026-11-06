import * as THREE from 'three';
import { type GuidanceSuggestion, type SiteLayout } from '@hht/shared';
import type { ProfileStore } from '../profile/guestProfile.ts';
/** One optional guidance message with one world target. Ordinary construction slot markers remain. */
export class GameplayGuide {
  private readonly panel = document.createElement('div');
  private readonly message = document.createElement('div');
  private readonly toggle = document.createElement('button');
  private readonly arrow = document.createElement('div');
  private readonly v = new THREE.Vector3();
  constructor(private readonly root: HTMLElement, private readonly profile: ProfileStore, onHelp: () => void, onHide: () => void) {
    this.panel.className = 'gameplay-guide';
    this.message.dataset.testid = 'gameplay-guide';
    this.message.setAttribute('role', 'status');
    this.toggle.dataset.testid = 'toggle-guidance';
    this.toggle.onclick = () => { const hidden = !profile.get().guidanceHidden; profile.update({ guidanceHidden: hidden }); if (hidden) onHide(); this.update(null); };
    const help = document.createElement('button');
    help.textContent = 'Machine help'; help.onclick = onHelp;
    this.panel.append(this.message, this.toggle, help);
    this.arrow.className = 'hud-arrow guidance-arrow';
    this.arrow.style.display = 'none';
    this.arrow.dataset.testid = 'guidance-target';
    root.append(this.panel, this.arrow);
    this.update(null);
  }
  update(s: GuidanceSuggestion | null): void {
    const hidden = this.profile.get().guidanceHidden;
    const text = hidden ? '' : s?.text ?? '';
    if (this.message.textContent !== text) this.message.textContent = text;
    this.message.hidden = !text;
    const label = hidden ? 'Show guidance' : 'Hide guidance';
    // Preserve the click target between pointer-down and pointer-up (including Safari).
    if (this.toggle.textContent !== label) this.toggle.textContent = label;
    if (!s || hidden) this.arrow.style.display = 'none';
  }
  target(s: GuidanceSuggestion | null, site: SiteLayout, plot: number, camera: THREE.Camera, origin?: { x: number; z: number }): void {
    this.arrow.style.display = 'none';
    if (!s || this.profile.get().guidanceHidden) return;
    const t = s.target;
    const spots = site.machines[plot];
    const def = site.plots[plot];
    let at: { x: number; z: number } | undefined;
    switch (t.kind) {
      case 'foreman': at = site.foreman; break;
      case 'rack': at = site.racks.filter(r => r.type === t.material).sort((a,b) => origin ? Math.hypot(a.x-origin.x,a.z-origin.z)-Math.hypot(b.x-origin.x,b.z-origin.z) : 0)[0]; break;
      case 'bin': at = site.plots[t.plot]?.bin; break;
      case 'hopper': at = spots?.mixer.hopper; break;
      case 'chute': at = spots?.mixer.chute; break;
      case 'pad': at = spots?.hookPad; break;
      case 'spoil': at = spots?.spoil; break;
      case 'pit': case 'slot': at = def; break;
      default: return; // machine target uses the existing 3D machine cue
    }
    if (!at) return;
    this.v.set(at.x, 2, at.z).project(camera);
    if (this.v.z < -1 || this.v.z > 1) return;
    const w = this.root.clientWidth || innerWidth, h = this.root.clientHeight || innerHeight;
    this.arrow.style.display = '';
    this.arrow.style.left = `${THREE.MathUtils.clamp((this.v.x + 1) * w / 2, 24, w - 24) - 16}px`;
    this.arrow.style.top = `${THREE.MathUtils.clamp((1 - this.v.y) * h / 2, 80, h - 120) - 24}px`;
  }
}
