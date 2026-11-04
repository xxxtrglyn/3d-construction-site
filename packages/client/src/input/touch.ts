import type { Actions, ButtonAction } from './actions.ts';
import '../ui/touchControls.css';

/**
 * Touch source: dynamic joystick on the left half, drag-to-orbit on the right half,
 * and [JUMP] [GRAB/DROP] [TOSS] buttons. Controls appear after the first touch.
 */
export class TouchControls {
  readonly root: HTMLDivElement;
  private readonly stick: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly actionBtn: HTMLButtonElement;
  private readonly tossBtn: HTMLButtonElement;
  private readonly jumpBtn: HTMLButtonElement;
  private holding = false;
  private machine: { action: string; disabled: boolean; toss: string | null } | null = null;
  private stickId: number | null = null;
  private lookId: number | null = null;
  private origin = { x: 0, y: 0 };
  private last = { x: 0, y: 0 };
  private hideTimer = 0;
  private readonly RADIUS = 56;

  constructor(private readonly actions: Actions, private readonly surface: HTMLElement, hud: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'touch-ui hidden';
    this.stick = document.createElement('div');
    this.stick.className = 'touch-stick';
    this.knob = document.createElement('div');
    this.knob.className = 'touch-knob';
    this.stick.appendChild(this.knob);
    const buttons = document.createElement('div');
    buttons.className = 'touch-buttons';
    const mk = (label: string, cls: string, action: ButtonAction): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = `touch-btn ${cls}`;
      b.textContent = label;
      b.setAttribute('aria-label', label);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.actions.lastDevice = 'touch';
        this.actions.press(action);
      });
      const up = (e: Event): void => {
        e.preventDefault();
        this.actions.release(action);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      return b;
    };
    this.tossBtn = mk('TOSS', 'toss', 'toss');
    this.actionBtn = mk('GRAB', 'action', 'action');
    this.jumpBtn = mk('JUMP', 'jump', 'jump');
    buttons.append(this.tossBtn, this.jumpBtn, this.actionBtn);
    this.root.append(this.stick, buttons);
    hud.appendChild(this.root);

    surface.addEventListener('touchstart', this.onTouchStart, { passive: false });
    surface.addEventListener('touchmove', this.onTouchMove, { passive: false });
    surface.addEventListener('touchend', this.onTouchEnd);
    surface.addEventListener('touchcancel', this.onTouchEnd);
    window.addEventListener('keydown', this.onKeyboard);
  }

  /** Update the context label: GRAB when empty-handed, DROP while holding. Toss shows only while holding. */
  setHolding(holding: boolean): void {
    this.holding = holding;
    if (this.machine) return;
    this.actionBtn.textContent = holding ? 'DROP' : 'GRAB';
    this.tossBtn.classList.toggle('hidden', !holding);
  }

  /**
   * Feature 003: while operating, the buttons are re-mapped, not added — ACTION names the next machine
   * action (greyed with a reason when nothing is possible), JUMP reads "Exit", TOSS reads "Camera" in the
   * crane and is hidden otherwise. `null` restores the walking labels.
   */
  setMachineMode(m: { action: string; disabled: boolean; toss: string | null } | null): void {
    const key = m ? `${m.action}|${m.disabled}|${m.toss}` : '';
    const prev = this.machine ? `${this.machine.action}|${this.machine.disabled}|${this.machine.toss}` : '';
    if (key === prev) return;
    this.machine = m;
    if (!m) {
      this.jumpBtn.textContent = 'JUMP';
      this.actionBtn.classList.remove('disabled');
      this.setHolding(this.holding);
      return;
    }
    this.actionBtn.textContent = m.action.toUpperCase();
    this.actionBtn.classList.toggle('disabled', m.disabled);
    this.jumpBtn.textContent = 'EXIT';
    this.tossBtn.textContent = m.toss ? m.toss.toUpperCase() : 'TOSS';
    this.tossBtn.classList.toggle('hidden', !m.toss);
  }

  private show(): void {
    this.root.classList.remove('hidden');
    window.clearTimeout(this.hideTimer);
  }

  private readonly onKeyboard = (): void => {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.root.classList.add('hidden'), 10_000);
  };

  private readonly onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    this.show();
    this.actions.lastDevice = 'touch';
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < window.innerWidth * 0.5 && this.stickId === null) {
        this.stickId = t.identifier;
        this.origin = { x: t.clientX, y: t.clientY };
        this.stick.style.left = `${t.clientX}px`;
        this.stick.style.top = `${t.clientY}px`;
        this.stick.classList.add('active');
      } else if (this.lookId === null) {
        this.lookId = t.identifier;
        this.last = { x: t.clientX, y: t.clientY };
      }
    }
  };

  private readonly onTouchMove = (e: TouchEvent): void => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        let dx = t.clientX - this.origin.x;
        let dy = t.clientY - this.origin.y;
        const l = Math.hypot(dx, dy);
        if (l > this.RADIUS) {
          dx *= this.RADIUS / l;
          dy *= this.RADIUS / l;
        }
        this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
        const mx = dx / this.RADIUS;
        const my = -dy / this.RADIUS;
        this.actions.setMove(mx, my);
        this.actions.run = Math.hypot(mx, my) > 0.85;
      } else if (t.identifier === this.lookId) {
        this.actions.addLook((t.clientX - this.last.x) * 0.008, (t.clientY - this.last.y) * 0.005);
        this.last = { x: t.clientX, y: t.clientY };
      }
    }
  };

  private readonly onTouchEnd = (e: TouchEvent): void => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        this.stickId = null;
        this.knob.style.transform = '';
        this.stick.classList.remove('active');
        this.actions.setMove(0, 0);
        this.actions.run = false;
      } else if (t.identifier === this.lookId) {
        this.lookId = null;
      }
    }
  };

  dispose(): void {
    this.surface.removeEventListener('touchstart', this.onTouchStart);
    this.surface.removeEventListener('touchmove', this.onTouchMove);
    this.surface.removeEventListener('touchend', this.onTouchEnd);
    this.surface.removeEventListener('touchcancel', this.onTouchEnd);
    window.removeEventListener('keydown', this.onKeyboard);
    this.root.remove();
  }
}
