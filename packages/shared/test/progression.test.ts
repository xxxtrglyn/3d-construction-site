import { describe, expect, it } from 'vitest';
import {
  CLOCK_TOWER, CLOCK_TOWER_V1, deliver, dig, filledTotal, groundworkDone, initialProgress, isMasterpiece, needsOf, neededPiece,
  neededSupplies, neededSupply, openSlots, openSlotsOf, pour, reset, starsOf,
  type Blueprint, type PieceTypeId, type TowerProgress, type Via,
} from '../src/index.ts';

const grounded = (bp: Blueprint = CLOCK_TOWER): TowerProgress => ({ ...initialProgress(bp), groundDug: 6, groundPoured: 4 });

/** Every slot of the current stage: ordinary slots by hand, high slots by the crane (recipe order). */
const stageDeliveries = (bp: Blueprint, stageIdx: number): Array<[PieceTypeId, Via, boolean]> => {
  const st = bp.stages[stageIdx]!;
  const out: Array<[PieceTypeId, Via, boolean]> = [];
  for (const r of st.recipe) {
    for (let i = 0; i < r.count - r.high; i++) out.push([r.type, 'hand', false]);
    for (let i = 0; i < r.high; i++) out.push([r.type, 'crane', true]);
  }
  return out;
};

/** Seeded shuffle (mulberry32) so mixed orders are reproducible. */
const shuffle = <T>(xs: T[], seed: number): T[] => {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
};

const toStage = (stage: number, bp: Blueprint = CLOCK_TOWER): TowerProgress => {
  let p = grounded(bp);
  while (p.completedStages < stage - 1) {
    for (const [t, via, high] of stageDeliveries(bp, p.completedStages)) p = deliver(p, t, via, { high }).progress;
  }
  return p;
};

const fullRun = (bp: Blueprint) => {
  let p = grounded(bp);
  const results: string[] = [];
  bp.stages.forEach((_, si) => {
    for (const [t, via, high] of stageDeliveries(bp, si)) {
      const r = deliver(p, t, via, { high });
      p = r.progress;
      results.push(r.result);
    }
  });
  return { p, results };
};

// ---------------------------------------------------------------- both recipe versions

for (const [bp, total] of [[CLOCK_TOWER, 31], [CLOCK_TOWER_V1, 30]] as const) {
  describe(`progression (${bp.id})`, () => {
    it('starts empty with 0 stars needing beams; filled matches the first stage', () => {
      const p = initialProgress(bp);
      expect(p).toMatchObject({ blueprintId: bp.id, completedStages: 0, highFilled: 0, groundDug: 0, groundPoured: 0 });
      expect(p.filled).toEqual(bp.stages[0]!.recipe.map(() => 0));
      expect(starsOf(p)).toBe(0);
      expect(neededPiece(p)).toBe('beam');
    });
    it(`${total} correct deliveries reach the masterpiece`, () => {
      const { p, results } = fullRun(bp);
      expect(results).toHaveLength(total);
      expect(results.filter((r) => r === 'stageComplete')).toHaveLength(5);
      expect(results.at(-1)).toBe('masterpiece');
      expect(isMasterpiece(p)).toBe(true);
      expect(starsOf(p)).toBe(5);
      expect(neededPiece(p)).toBeNull();
      expect(p.filled).toEqual([]);
      expect(deliver(p, 'bell').result).toBe('alreadyComplete');
    });
    it('stars grow one per stage (5 at the Masterpiece)', () => {
      let p = grounded(bp);
      const stars: number[] = [];
      bp.stages.forEach((_, si) => {
        for (const [t, via, high] of stageDeliveries(bp, si)) p = deliver(p, t, via, { high }).progress;
        stars.push(starsOf(p));
      });
      expect(stars).toEqual([1, 2, 3, 4, 5, 5]);
    });
    it('one delivery never advances more than one slot', () => {
      let p = grounded(bp);
      bp.stages.forEach((_, si) => {
        for (const [t, via, high] of stageDeliveries(bp, si)) {
          const before = p;
          p = deliver(p, t, via, { high }).progress;
          if (p.completedStages === before.completedStages) expect(filledTotal(p) - filledTotal(before)).toBe(1);
          else expect(p.completedStages - before.completedStages).toBe(1);
        }
      });
    });
    it('reset returns to the empty foundation of the same blueprint', () => {
      expect(reset(fullRun(bp).p)).toEqual(initialProgress(bp));
    });
    it('a piece not in the recipe is wrongPiece and leaves progress unchanged', () => {
      const p = grounded(bp);
      for (const t of ['paint', 'cone', 'concrete'] as PieceTypeId[]) {
        const r = deliver(p, t);
        expect(r.result).toBe('wrongPiece');
        expect(r.progress).toBe(p);
      }
    });
  });
}

// ---------------------------------------------------------------- feature 004: mixed recipes

describe('progression 004: two materials per stage', () => {
  it('a mixed-order Frame (brick, beam, beam, brick, beam, beam) completes on the 6th piece', () => {
    let p = grounded();
    const order: PieceTypeId[] = ['brick', 'beam', 'beam', 'brick', 'beam', 'beam'];
    const filled: number[][] = [];
    const results: string[] = [];
    for (const t of order) {
      const r = deliver(p, t, 'hand');
      results.push(r.result);
      p = r.progress;
      filled.push([...p.filled]);
    }
    expect(results).toEqual(['snapped', 'snapped', 'snapped', 'snapped', 'snapped', 'stageComplete']);
    expect(filled.slice(0, 5)).toEqual([[0, 1], [1, 1], [2, 1], [2, 2], [3, 2]]);
    expect(p).toMatchObject({ completedStages: 1, highFilled: 0 });
    expect(p.filled).toEqual([0, 0]); // Walls & Floors: brick, beam
  });
  for (let si = 0; si < 6; si++) {
    it(`stage ${si + 1} completes in any (seeded) order, only on the last piece`, () => {
      for (const seed of [1, 7, 42]) {
        let p = toStage(si + 1);
        const steps = shuffle(stageDeliveries(CLOCK_TOWER, si), seed + si);
        steps.forEach(([t, via, high], k) => {
          const r = deliver(p, t, via, { high });
          const last = k === steps.length - 1;
          expect(r.result).toBe(last ? (si === 5 ? 'masterpiece' : 'stageComplete') : 'snapped');
          p = r.progress;
        });
        expect(p.completedStages).toBe(si + 1);
      }
    });
  }
  it('the Masterpiece waits for both the bell and the decor crate, in either order', () => {
    const base = toStage(6);
    const a = deliver(base, 'decor', 'hand');
    expect(a.result).toBe('snapped');
    expect(deliver(a.progress, 'bell', 'crane', { high: true }).result).toBe('masterpiece');
    const b = deliver(base, 'bell', 'crane', { high: true });
    expect(b.result).toBe('snapped');
    expect(deliver(b.progress, 'decor', 'hand').result).toBe('masterpiece');
  });
  it('per-material open slots', () => {
    const p = toStage(3); // panel×4 (high 3) + beam×2
    expect(openSlotsOf(p, 'panel')).toEqual({ ordinary: 1, high: 3 });
    expect(openSlotsOf(p, 'beam')).toEqual({ ordinary: 2, high: 0 });
    expect(openSlotsOf(p, 'paint')).toEqual({ ordinary: 0, high: 0 });
    expect(openSlots(p)).toEqual({ hand: 3, high: 3 });
  });
});

describe('progression 004: refusals (data-model §5 order)', () => {
  it('a complete material is surplus and leaves progress unchanged', () => {
    let p = grounded();
    p = deliver(p, 'brick').progress;
    p = deliver(p, 'brick').progress;
    const r = deliver(p, 'brick');
    expect(r.result).toBe('surplus');
    expect(r.progress).toBe(p);
    expect(deliver(p, 'brick', 'crane').result).toBe('surplus');
  });
  it('a hand or forklift panel is tooHigh once only the high panel slots remain', () => {
    let p = toStage(3);
    p = deliver(p, 'panel', 'hand').progress; // the one ordinary panel slot
    for (const via of ['hand', 'forklift'] as Via[]) {
      const r = deliver(p, 'panel', via);
      expect(r.result).toBe('tooHigh');
      expect(r.progress).toBe(p);
    }
    expect(deliver(p, 'beam', 'hand').result).toBe('snapped'); // the other material is unaffected
  });
  it('surplus beats tooHigh when the high material is complete', () => {
    let p = toStage(3);
    p = deliver(p, 'panel', 'hand').progress;
    for (let i = 0; i < 3; i++) p = deliver(p, 'panel', 'crane', { high: true }).progress;
    expect(deliver(p, 'panel', 'hand').result).toBe('surplus');
    expect(deliver(p, 'panel', 'crane', { high: true }).result).toBe('surplus');
  });
  it('the crane fills an ordinary slot when aimed at one, and a high slot when only high ones remain', () => {
    let p = toStage(3);
    p = deliver(p, 'panel', 'crane', { high: false }).progress;
    expect(p).toMatchObject({ filled: [1, 0], highFilled: 0 });
    p = deliver(p, 'panel', 'crane').progress; // no ordinary panel slot left → high
    expect(p).toMatchObject({ filled: [2, 0], highFilled: 1 });
    p = deliver(p, 'beam', 'crane').progress; // a beam by crane takes a beam slot
    expect(p).toMatchObject({ filled: [2, 1], highFilled: 1 });
    p = deliver(p, 'beam', 'crane', { high: true }).progress; // beams have no high slots: ordinary
    expect(p).toMatchObject({ filled: [2, 2], highFilled: 1 });
  });
  it('the bell needs the crane; the decor crate goes by hand', () => {
    const p = toStage(6);
    expect(deliver(p, 'bell', 'hand').result).toBe('tooHigh');
    expect(deliver(p, 'bell', 'forklift').result).toBe('tooHigh');
    expect(deliver(p, 'decor', 'forklift').result).toBe('snapped');
  });
});

describe('progression 004: needs', () => {
  it('needsOf lists every material in recipe order with left / highLeft / craneOnly / done', () => {
    let p = toStage(3);
    expect(needsOf(p)).toEqual([
      { type: 'panel', total: 4, left: 4, highLeft: 3, craneOnly: false, done: false },
      { type: 'beam', total: 2, left: 2, highLeft: 0, craneOnly: false, done: false },
    ]);
    p = deliver(p, 'panel').progress;
    p = deliver(p, 'beam').progress;
    p = deliver(p, 'beam').progress;
    expect(needsOf(p)).toEqual([
      { type: 'panel', total: 4, left: 3, highLeft: 3, craneOnly: true, done: false },
      { type: 'beam', total: 2, left: 0, highLeft: 0, craneOnly: false, done: true },
    ]);
    expect(neededSupplies(p)).toEqual(['panel']);
  });
  it('Groundwork and the finished tower have no needs; supplies follow Groundwork', () => {
    const p = initialProgress();
    expect(needsOf(p)).toEqual([]);
    expect(neededSupplies(p)).toEqual([]);
    expect(neededSupply(p)).toBeNull();
    let d = p;
    for (let i = 0; i < 6; i++) d = dig(d);
    expect(neededSupplies(d)).toEqual(['cement']);
    expect(neededSupplies(grounded())).toEqual(['beam', 'brick']);
    expect(needsOf(fullRun(CLOCK_TOWER).p)).toEqual([]);
  });
});

// ---------------------------------------------------------------- feature 003: Groundwork (unchanged rules)

describe('progression: Groundwork', () => {
  const dug = (p: TowerProgress = initialProgress()): TowerProgress => {
    for (let i = 0; i < 6; i++) p = dig(p);
    return p;
  };
  it('starts with Groundwork at 0', () => {
    const p = initialProgress();
    expect(groundworkDone(p)).toBe(false);
  });
  it('dig caps at 6', () => {
    let p = initialProgress();
    for (let i = 0; i < 9; i++) p = dig(p);
    expect(p.groundDug).toBe(6);
    expect(dig(p)).toBe(p);
  });
  it('pour needs the pit dug and caps at 4; the 4th completes Groundwork', () => {
    expect(pour(initialProgress()).result).toBe('notDug');
    let p = initialProgress();
    for (let i = 0; i < 5; i++) p = dig(p);
    expect(pour(p).result).toBe('notDug');
    p = dug();
    const results: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = pour(p);
      p = r.progress;
      results.push(r.result);
    }
    expect(results).toEqual(['poured', 'poured', 'poured', 'groundworkDone']);
    expect(groundworkDone(p)).toBe(true);
    expect(pour(p).result).toBe('alreadyPoured');
    expect(pour(p).progress).toBe(p);
  });
  it('deliveries before Groundwork is done are groundworkFirst, by any route, concrete included', () => {
    for (const via of ['hand', 'forklift', 'crane'] as Via[]) {
      for (const p of [initialProgress(), dug()]) {
        expect(deliver(p, 'beam', via).result).toBe('groundworkFirst');
        expect(deliver(p, 'concrete', via).result).toBe('groundworkFirst');
        expect(deliver(p, 'beam', via).progress).toBe(p);
      }
    }
  });
  it('legacy towers keep the 003 high-slot rules (6 panels, 3 by crane)', () => {
    let p = toStage(3, CLOCK_TOWER_V1);
    for (let i = 0; i < 3; i++) p = deliver(p, 'panel', i % 2 ? 'forklift' : 'hand').progress;
    expect(p).toMatchObject({ filled: [3], highFilled: 0 });
    expect(deliver(p, 'panel', 'hand').result).toBe('tooHigh');
    p = deliver(p, 'panel', 'crane', { high: true }).progress;
    expect(p).toMatchObject({ filled: [4], highFilled: 1 });
    expect(deliver(p, 'beam', 'hand').result).toBe('wrongPiece');
  });
});
