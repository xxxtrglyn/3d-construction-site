/**
 * Device-independent player actions (contracts/controls.md). Gameplay reads only this.
 * Sources (keyboard/mouse, touch, gamepad) write into it; `endFrame()` clears one-shot edges.
 */
export interface Vec2 {
  x: number;
  y: number;
}

export type ButtonAction = 'jump' | 'action' | 'toss' | 'respawn' | 'menu';

export class Actions {
  /** move: x = right, y = forward, length ≤ 1 */
  readonly move: Vec2 = { x: 0, y: 0 };
  /** accumulated camera orbit delta this frame (radians-ish units) */
  readonly look: Vec2 = { x: 0, y: 0 };
  run = false;
  private readonly held = new Map<ButtonAction, number>();
  private readonly pressed = new Set<ButtonAction>();
  private readonly released = new Map<ButtonAction, number>();
  lastDevice: 'keyboard' | 'touch' | 'gamepad' = 'keyboard';

  setMove(x: number, y: number): void {
    const l = Math.hypot(x, y);
    const k = l > 1 ? 1 / l : 1;
    this.move.x = x * k;
    this.move.y = y * k;
  }

  addLook(dx: number, dy: number): void {
    this.look.x += dx;
    this.look.y += dy;
  }

  press(a: ButtonAction, now = performance.now()): void {
    if (this.held.has(a)) return;
    this.held.set(a, now);
    this.pressed.add(a);
  }

  release(a: ButtonAction, now = performance.now()): void {
    const t = this.held.get(a);
    if (t === undefined) return;
    this.held.delete(a);
    this.released.set(a, (now - t) / 1000);
  }

  isHeld(a: ButtonAction): boolean {
    return this.held.has(a);
  }

  /** seconds the button has been held, or 0 */
  heldFor(a: ButtonAction, now = performance.now()): number {
    const t = this.held.get(a);
    return t === undefined ? 0 : (now - t) / 1000;
  }

  wasPressed(a: ButtonAction): boolean {
    return this.pressed.has(a);
  }

  /** hold duration in seconds if released this frame, else null */
  releasedAfter(a: ButtonAction): number | null {
    return this.released.get(a) ?? null;
  }

  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.look.x = 0;
    this.look.y = 0;
  }

  releaseAll(): void {
    for (const a of [...this.held.keys()]) this.release(a);
    this.setMove(0, 0);
    this.run = false;
  }
}
