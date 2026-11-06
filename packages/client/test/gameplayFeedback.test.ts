import { expect, it } from 'vitest';
import { successText, recoveryText, reducedMotion } from '../src/game/gameplayFeedback.ts';
import { controlLabels } from '../src/ui/machineHints.ts';
it('gives an actionable recovery for every refusal without claiming success', () => {
  for (const reason of ['binFull', 'mixerFull', 'tooHigh', 'notCrew', 'busy', 'handsFull', 'tooFar', 'groundworkFirst']) {
    const text = recoveryText(reason);
    expect(text.length).toBeGreaterThan(20);
    expect(text).not.toContain('complete!');
  }
  expect(recoveryText('groundworkFirst', null, 'dig')).toContain('excavator');
  expect(reducedMotion()).toBe(false);
});
it('uses action bindings appropriate to each device', () => {
  expect(controlLabels('keyboard').action).toBe('E');
  expect(controlLabels('gamepad')).toMatchObject({ action: 'X / Square', exit: 'A / Cross', camera: 'B / Circle' });
  expect(controlLabels('touch')).toMatchObject({ action: 'Action', exit: 'Get out' });
});

it('confirms only productive feedback outcomes', () => {
  expect(successText('snap')).toContain('placed');
  expect(successText('dump')).toContain('Dirt');
  expect(successText('wrongPiece')).toBeNull();
  expect(successText('hookRelease')).toBeNull();
  expect(successText('predicted')).toBeNull();
});
