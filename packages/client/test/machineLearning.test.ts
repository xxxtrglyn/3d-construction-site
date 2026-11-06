import { expect, it } from 'vitest';
import { learnedMachine, recoveryText } from '../src/game/gameplayFeedback.ts';
it('only attributable productive operations complete learning', () => {
  for (const act of ['scoop', 'dumpBack', 'hookRelease', 'palletUnload', 'mixDone']) expect(learnedMachine({ act, by: 'me' }, 'me')).toBeNull();
  expect(learnedMachine({ act: 'dump', by: 'me' }, 'me')).toBe('excavator');
  expect(learnedMachine({ act: 'palletLoad', by: 'me' }, 'me')).toBe('forklift');
  expect(learnedMachine({ act: 'mixStart', by: 'other' }, 'me')).toBeNull();
  expect(learnedMachine({ act: 'mixStart' }, 'me')).toBeNull();
  expect(learnedMachine({ act: 'snap', via: 'crane', by: 'me' }, 'me')).toBe('crane');
  expect(learnedMachine({ act: 'snap', via: 'hand', by: 'me' }, 'me')).toBeNull();
});
it('refusals explain recovery without inventing a target', () => {
  expect(recoveryText('tooHigh')).toContain('crane');
  expect(recoveryText('mixerFull')).toContain('ground');
  expect(recoveryText('wrongPiece', 'beam')).toContain('rack');
  expect(recoveryText('unknown')).toContain('help');
});
