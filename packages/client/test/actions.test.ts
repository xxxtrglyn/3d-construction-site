import { describe, expect, it } from 'vitest';
import { Actions } from '../src/input/actions.ts';

describe('Actions', () => {
  it('normalizes diagonal movement', () => {
    const a = new Actions();
    a.setMove(1, 1);
    expect(Math.hypot(a.move.x, a.move.y)).toBeCloseTo(1);
  });
  it('tracks press/release edges and hold time', () => {
    const a = new Actions();
    a.press('action', 1000);
    expect(a.wasPressed('action')).toBe(true);
    a.endFrame();
    expect(a.wasPressed('action')).toBe(false);
    a.release('action', 1500);
    expect(a.releasedAfter('action')).toBeCloseTo(0.5);
    a.endFrame();
    expect(a.releasedAfter('action')).toBeNull();
  });
});
