import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LOOSE } from '@hht/shared';
import { PieceManager } from '../src/game/pieceManager.ts';

const at = new THREE.Vector3(0, 1, 0);
const q = new THREE.Quaternion();

describe('PieceManager (no physics)', () => {
  it('allows only one held piece', () => {
    const m = new PieceManager(null);
    const a = m.create('beam', 'loose', at);
    const b = m.create('brick', 'loose', at);
    expect(m.pickUp(a)).toBe(true);
    expect(m.pickUp(b)).toBe(false);
    expect(m.held()?.id).toBe(a.id);
  });

  it('caps loose pieces at 30, fading the oldest first', () => {
    const m = new PieceManager(null);
    const made = [];
    for (let i = 0; i < LOOSE.maxLoose + 3; i++) {
      m.clock = i;
      const p = m.create('brick', 'held', at);
      m.release(p, at, q);
      made.push(p);
    }
    const fading = made.filter((p) => p.fade > 0).map((p) => p.id);
    expect(fading).toEqual(made.slice(0, 3).map((p) => p.id));
    m.update(1); // fade completes after 0.5 s
    expect(m.loose().length).toBe(LOOSE.maxLoose);
  });

  it('fades pieces untouched for 60 s', () => {
    const m = new PieceManager(null);
    const p = m.create('panel', 'held', at);
    m.release(p, at, q);
    m.update(LOOSE.fadeAfterSeconds - 1);
    expect(p.fade).toBe(0);
    m.update(1.01);
    expect(p.fade).toBeGreaterThan(0);
    m.update(0.6);
    expect(m.pieces.has(p.id)).toBe(false);
  });

  it('removes pieces that fall off the lot', () => {
    const m = new PieceManager(null);
    const p = m.create('cone', 'held', at);
    m.release(p, new THREE.Vector3(0, LOOSE.respawnBelowY - 1, 0), q);
    m.update(0.016);
    expect(m.pieces.has(p.id)).toBe(false);
  });

  it('repeated pick-up/drop never duplicates pieces', () => {
    const m = new PieceManager(null);
    const p = m.create('beam', 'loose', at);
    for (let i = 0; i < 50; i++) {
      m.pickUp(p);
      m.pickUp(p);
      m.release(p, at, q);
    }
    expect(m.pieces.size).toBe(1);
  });
});
