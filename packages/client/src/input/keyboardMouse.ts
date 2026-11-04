import type { Actions, ButtonAction } from './actions.ts';

const KEY_ACTIONS: Record<string, ButtonAction> = {
  Space: 'jump',
  KeyE: 'action',
  KeyQ: 'toss',
  KeyR: 'respawn',
  Escape: 'menu',
};

/** Keyboard + mouse source. Movement from WASD/arrows, orbit with right-drag (or left-drag on empty canvas). */
export function attachKeyboardMouse(actions: Actions, canvas: HTMLElement, onUse: () => void): () => void {
  const down = new Set<string>();
  const updateMove = (): void => {
    const x = (down.has('KeyD') || down.has('ArrowRight') ? 1 : 0) - (down.has('KeyA') || down.has('ArrowLeft') ? 1 : 0);
    const y = (down.has('KeyW') || down.has('ArrowUp') ? 1 : 0) - (down.has('KeyS') || down.has('ArrowDown') ? 1 : 0);
    actions.setMove(x, y);
    actions.run = down.has('ShiftLeft') || down.has('ShiftRight');
  };
  const isTyping = (e: KeyboardEvent): boolean => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (isTyping(e)) return;
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    down.add(e.code);
    actions.lastDevice = 'keyboard';
    onUse();
    const a = KEY_ACTIONS[e.code];
    if (a) actions.press(a);
    updateMove();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    down.delete(e.code);
    const a = KEY_ACTIONS[e.code];
    if (a) actions.release(a);
    updateMove();
  };
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return;
    onUse();
    actions.lastDevice = 'keyboard';
    if (e.button === 0) actions.press('action');
    if (e.button === 2 || e.button === 1) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture?.(e.pointerId);
    }
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || !dragging) return;
    actions.addLook((e.clientX - lastX) * 0.006, (e.clientY - lastY) * 0.004);
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return;
    if (e.button === 0) actions.release('action');
    if (e.button === 2 || e.button === 1) dragging = false;
  };
  const onWheel = (e: WheelEvent): void => {
    actions.addLook(0, 0);
    canvas.dispatchEvent(new CustomEvent('hht-zoom', { detail: Math.sign(e.deltaY) }));
  };
  const onContext = (e: Event): void => e.preventDefault();
  const onBlur = (): void => {
    down.clear();
    actions.releaseAll();
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: true });
  canvas.addEventListener('contextmenu', onContext);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    canvas.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContext);
  };
}
