import { describe, expect, it } from 'vitest';
import { CLOCK_TOWER, deliver, initialProgress, needsOf, type Need, type TowerProgress } from '@hht/shared';
import { chipsText, countNoun, foremanLine, hintLine } from '../src/ui/needsText.ts';

const need = (type: Need['type'], left: number, total: number, highLeft = 0): Need => ({
  type, total, left, highLeft, craneOnly: left > 0 && left === highLeft, done: left === 0,
});
const grounded = (): TowerProgress => ({ ...initialProgress(CLOCK_TOWER), groundDug: 6, groundPoured: 4 });

describe('needs text (contracts/needs-display.md)', () => {
  it('singular and plural nouns', () => {
    expect(countNoun('beam', 1)).toBe('1 beam');
    expect(countNoun('beam', 2)).toBe('2 beams');
    expect(countNoun('paint', 3)).toBe('3 paint buckets');
    expect(countNoun('decor', 1)).toBe('1 decor crate');
  });
  it('chips: count, crane mark, check mark, recipe order', () => {
    expect(chipsText([need('beam', 3, 4), need('brick', 0, 2)])).toBe('Beams 3 · Bricks ✓');
    expect(chipsText([need('panel', 3, 4, 3), need('beam', 1, 2)])).toBe('Panels 3 🏗️ · Beams 1');
    expect(chipsText(needsOf(grounded()))).toBe('Beams 4 · Bricks 2');
  });
  it('Foreman lines: two materials, one material, crane only, nothing left', () => {
    expect(foremanLine([need('brick', 2, 6), need('beam', 1, 2)])).toBe('Bring 2 bricks and 1 beam!');
    expect(foremanLine([need('brick', 0, 6), need('beam', 2, 2)])).toBe('Just 2 beams to go!');
    expect(foremanLine([need('panel', 3, 4, 3), need('beam', 0, 2)])).toBe('Only the crane can finish this: 3 panels up top!');
    expect(foremanLine([need('bell', 1, 1, 1), need('decor', 0, 1)])).toBe('Only the crane can finish this: 1 golden bell up top!');
    expect(foremanLine([need('beam', 0, 4), need('brick', 0, 2)])).toBeNull();
  });
  it('hint lines: wrongPiece, surplus, binNotNeeded, tooHigh', () => {
    expect(hintLine({ kind: 'wrongPiece', needed: ['beam', 'brick'] }, 'Frame')).toBe('The Frame needs beams and bricks now');
    expect(hintLine({ kind: 'wrongPiece', needed: ['beam'] }, 'Frame')).toBe('The Frame needs beams now');
    expect(hintLine({ kind: 'wrongPiece', needed: [] }, null)).toBe('Not needed here');
    expect(hintLine({ kind: 'surplus', type: 'brick', needed: ['beam'] }, 'Frame')).toBe('Enough bricks, the Frame needs beams now');
    expect(hintLine({ kind: 'surplus', type: 'brick', needed: [] }, 'Frame')).toBe('Enough bricks!');
    expect(hintLine({ kind: 'binNotNeeded', type: 'paint', needed: ['beam', 'brick'] }, 'Frame')).toBe('This plot has enough paint buckets: try beams and bricks');
    expect(hintLine({ kind: 'tooHigh' }, 'Roof & Windows')).toBe('Too high: use the crane');
    expect(hintLine({ kind: 'binFull' }, 'Frame')).toBeNull();
  });
  it('the chips follow the shared rules after each delivery', () => {
    let p = grounded();
    p = deliver(p, 'brick').progress;
    p = deliver(p, 'brick').progress;
    p = deliver(p, 'beam').progress;
    expect(chipsText(needsOf(p))).toBe('Beams 3 · Bricks ✓');
  });
});
