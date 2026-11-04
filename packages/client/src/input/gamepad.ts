import type { Actions, ButtonAction } from './actions.ts';

const BUTTONS: [number, ButtonAction][] = [
  [0, 'jump'], // A / Cross
  [2, 'action'], // X / Square
  [1, 'toss'], // B / Circle
  [8, 'respawn'], // Select / View
  [9, 'menu'], // Start / Menu
];
const DEAD = 0.18;

/** Poll the first connected gamepad once per frame. */
export function pollGamepad(actions: Actions): void {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = Array.from(pads).find((p) => p && p.connected);
  if (!pad) return;
  const ax = (i: number): number => {
    const v = pad.axes[i] ?? 0;
    return Math.abs(v) < DEAD ? 0 : v;
  };
  const mx = ax(0);
  const my = -ax(1);
  const active = mx !== 0 || my !== 0 || pad.buttons.some((b) => b.pressed);
  if (!active && actions.lastDevice !== 'gamepad') return;
  if (active) actions.lastDevice = 'gamepad';
  actions.setMove(mx, my);
  actions.run = Math.hypot(mx, my) > 0.85 || !!pad.buttons[4]?.pressed;
  actions.addLook(ax(2) * 0.05, ax(3) * 0.035);
  for (const [i, a] of BUTTONS) {
    if (pad.buttons[i]?.pressed) actions.press(a);
    else actions.release(a);
  }
}
