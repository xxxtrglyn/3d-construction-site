import { describe, expect, it } from 'vitest';
import { CLOCK_TOWER, deliver, initialProgress, isMasterpiece, neededPiece, reset, starsOf, type TowerProgress } from '../src/index.ts';

const fullRun = () => {
  let p: TowerProgress = initialProgress();
  const results: string[] = [];
  for (const stage of CLOCK_TOWER.stages) {
    for (let i = 0; i < stage.slotCount; i++) {
      const r = deliver(p, stage.pieceType);
      p = r.progress;
      results.push(r.result);
    }
  }
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
    const p = initialProgress();
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
    let p = initialProgress();
    const stars: number[] = [];
    for (const stage of CLOCK_TOWER.stages) {
      for (let i = 0; i < stage.slotCount; i++) p = deliver(p, stage.pieceType).progress;
      stars.push(starsOf(p));
    }
    expect(stars).toEqual([1, 2, 3, 4, 5, 5]);
  });

  it('one delivery never advances more than one slot', () => {
    let p = initialProgress();
    for (const stage of CLOCK_TOWER.stages) {
      for (let i = 0; i < stage.slotCount; i++) {
        const before = p.completedStages * 100 + p.filledSlots;
        p = deliver(p, stage.pieceType).progress;
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
