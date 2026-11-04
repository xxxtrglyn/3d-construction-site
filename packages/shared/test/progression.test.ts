import { describe, expect, it } from 'vitest';
import {
  CLOCK_TOWER, deliver, dig, groundworkDone, initialProgress, isMasterpiece, neededPiece, neededSupply, pour, reset, starsOf,
  type TowerProgress, type Via,
} from '../src/index.ts';

/** 001 rules: every slot by hand (high slots via the crane), after Groundwork. */
const ready = (): TowerProgress => ({ ...initialProgress(), groundDug: 6, groundPoured: 4 });
const fill = (p: TowerProgress, type: Parameters<typeof deliver>[1], i: number, stageIdx: number) => {
  const st = CLOCK_TOWER.stages[stageIdx]!;
  return i < st.slotCount - st.highSlots ? deliver(p, type, 'hand') : deliver(p, type, 'crane', { high: true });
};

const fullRun = () => {
  let p: TowerProgress = ready();
  const results: string[] = [];
  CLOCK_TOWER.stages.forEach((stage, si) => {
    for (let i = 0; i < stage.slotCount; i++) {
      const r = fill(p, stage.pieceType, i, si);
      p = r.progress;
      results.push(r.result);
    }
  });
  return { p, results };
};

describe('progression', () => {
  it('starts empty with 0 stars needing beams', () => {
    const p = initialProgress();
    expect(p.completedStages).toBe(0);
    expect(starsOf(p)).toBe(0);
    expect(neededPiece(p)).toBe('beam');
  });

  it('30 correct deliveries reach the masterpiece', () => {
    const { p, results } = fullRun();
    expect(results).toHaveLength(30);
    expect(results.filter((r) => r === 'stageComplete')).toHaveLength(5);
    expect(results.at(-1)).toBe('masterpiece');
    expect(isMasterpiece(p)).toBe(true);
    expect(starsOf(p)).toBe(5);
    expect(neededPiece(p)).toBeNull();
  });

  it('wrong piece leaves progress unchanged', () => {
    const p = ready();
    const r = deliver(p, 'brick');
    expect(r.result).toBe('wrongPiece');
    expect(r.progress).toBe(p);
    expect(deliver(p, 'cone').result).toBe('wrongPiece');
  });

  it('after masterpiece deliveries are alreadyComplete', () => {
    const { p } = fullRun();
    const r = deliver(p, 'bell');
    expect(r.result).toBe('alreadyComplete');
    expect(r.progress).toBe(p);
  });

  it('stars grow one per stage', () => {
    let p = ready();
    const stars: number[] = [];
    CLOCK_TOWER.stages.forEach((stage, si) => {
      for (let i = 0; i < stage.slotCount; i++) p = fill(p, stage.pieceType, i, si).progress;
      stars.push(starsOf(p));
    });
    expect(stars).toEqual([1, 2, 3, 4, 5, 5]);
  });

  it('one delivery never advances more than one slot', () => {
    let p = ready();
    for (const [si, stage] of CLOCK_TOWER.stages.entries()) {
      for (let i = 0; i < stage.slotCount; i++) {
        const before = p.completedStages * 100 + p.filledSlots;
        p = fill(p, stage.pieceType, i, si).progress;
        const after = p.completedStages * 100 + p.filledSlots;
        const advanced = p.filledSlots === 0 ? p.completedStages - Math.floor(before / 100) : after - before;
        expect(advanced).toBe(1);
      }
    }
  });

  it('reset returns to the empty foundation', () => {
    const { p } = fullRun();
    expect(reset(p)).toEqual(initialProgress());
  });
});

// ---------------------------------------------------------------- feature 003: Groundwork and high slots


const dug = (p: TowerProgress = initialProgress()): TowerProgress => {
  for (let i = 0; i < 6; i++) p = dig(p);
  return p;
};
const grounded = (p: TowerProgress = initialProgress()): TowerProgress => {
  p = dug(p);
  for (let i = 0; i < 4; i++) p = pour(p).progress;
  return p;
};
/** Fills stages until `stage` (1-based) is current, using the crane for high slots. */
const toStage = (stage: number): TowerProgress => {
  let p = grounded();
  while (p.completedStages < stage - 1) {
    const st = CLOCK_TOWER.stages[p.completedStages]!;
    for (let i = 0; i < st.slotCount - st.highSlots; i++) p = deliver(p, st.pieceType, 'hand').progress;
    for (let i = 0; i < st.highSlots; i++) p = deliver(p, st.pieceType, 'crane', { high: true }).progress;
  }
  return p;
};

describe('progression v2: Groundwork', () => {
  it('starts with Groundwork at 0', () => {
    const p = initialProgress();
    expect(p).toMatchObject({ groundDug: 0, groundPoured: 0, highFilled: 0, completedStages: 0, filledSlots: 0 });
    expect(groundworkDone(p)).toBe(false);
    expect(neededSupply(p)).toBeNull(); // digging needs no piece
  });
  it('dig caps at 6', () => {
    let p = initialProgress();
    for (let i = 0; i < 9; i++) p = dig(p);
    expect(p.groundDug).toBe(6);
    const same = dig(p);
    expect(same).toBe(p);
  });
  it('pour needs the pit dug and caps at 4; the 4th completes Groundwork', () => {
    expect(pour(initialProgress()).result).toBe('notDug');
    let p = initialProgress();
    for (let i = 0; i < 5; i++) p = dig(p);
    expect(pour(p).result).toBe('notDug');
    p = dug();
    expect(neededSupply(p)).toBe('cement');
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
    expect(neededSupply(p)).toBe('beam');
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
  it('after Groundwork a wrong piece is wrongPiece and a beam snaps', () => {
    const p = grounded();
    expect(deliver(p, 'brick', 'hand').result).toBe('wrongPiece');
    expect(deliver(p, 'concrete', 'hand').result).toBe('wrongPiece');
    expect(deliver(p, 'beam', 'hand').result).toBe('snapped');
  });
});

describe('progression v2: high slots', () => {
  it('hand and forklift deliveries are tooHigh once only high slots remain', () => {
    let p = toStage(3);
    expect(p.completedStages).toBe(2);
    for (let i = 0; i < 3; i++) {
      const r = deliver(p, 'panel', i % 2 ? 'forklift' : 'hand');
      expect(r.result).toBe('snapped');
      p = r.progress;
    }
    expect(p).toMatchObject({ filledSlots: 3, highFilled: 0 });
    for (const via of ['hand', 'forklift'] as Via[]) {
      const r = deliver(p, 'panel', via);
      expect(r.result).toBe('tooHigh');
      expect(r.progress).toBe(p);
    }
  });
  it('a crane delivery to a high slot increments highFilled; to a hand slot it does not', () => {
    let p = toStage(3);
    p = deliver(p, 'panel', 'crane', { high: true }).progress;
    expect(p).toMatchObject({ filledSlots: 1, highFilled: 1 });
    p = deliver(p, 'panel', 'crane', { high: false }).progress;
    expect(p).toMatchObject({ filledSlots: 2, highFilled: 1 });
    p = deliver(p, 'panel', 'crane').progress; // no slot info = a hand slot
    expect(p).toMatchObject({ filledSlots: 3, highFilled: 1 });
  });
  it('the crane cannot fill more high slots than the stage has', () => {
    let p = toStage(3);
    for (let i = 0; i < 3; i++) p = deliver(p, 'panel', 'crane', { high: true }).progress;
    expect(p.highFilled).toBe(3);
    const r = deliver(p, 'panel', 'crane', { high: true });
    expect(r.result).toBe('snapped'); // falls back to a free hand slot
    expect(r.progress).toMatchObject({ filledSlots: 4, highFilled: 3 });
  });
  it('highFilled resets when the stage completes; the bell needs the crane', () => {
    let p = toStage(3);
    for (let i = 0; i < 3; i++) p = deliver(p, 'panel', 'hand').progress;
    for (let i = 0; i < 2; i++) p = deliver(p, 'panel', 'crane', { high: true }).progress;
    const r = deliver(p, 'panel', 'crane', { high: true });
    expect(r.result).toBe('stageComplete');
    expect(r.progress).toMatchObject({ completedStages: 3, filledSlots: 0, highFilled: 0 });
    p = toStage(6);
    expect(deliver(p, 'bell', 'hand').result).toBe('tooHigh');
    expect(deliver(p, 'bell', 'forklift').result).toBe('tooHigh');
    expect(deliver(p, 'bell', 'crane', { high: true }).result).toBe('masterpiece');
  });
  it('stars are unchanged: 1 per stage, 5 at the Masterpiece', () => {
    let p = grounded();
    const stars: number[] = [];
    for (const st of CLOCK_TOWER.stages) {
      for (let i = 0; i < st.slotCount - st.highSlots; i++) p = deliver(p, st.pieceType, 'hand').progress;
      for (let i = 0; i < st.highSlots; i++) p = deliver(p, st.pieceType, 'crane', { high: true }).progress;
      stars.push(starsOf(p));
    }
    expect(stars).toEqual([1, 2, 3, 4, 5, 5]);
    expect(isMasterpiece(p)).toBe(true);
    expect(reset(p)).toEqual(initialProgress());
  });
});
