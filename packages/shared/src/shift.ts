import { SHIFT } from './constants.ts';

export type ShiftPhase = 'running' | 'warning' | 'countdown' | 'resetting';

/** Shift phase from the remaining time (data-model.md → Shift). The reset waits for celebrations. */
export function shiftPhase(now: number, endsAt: number, celebrating: boolean, warnMs: number = SHIFT.warnS * 1000, countdownMs: number = SHIFT.countdownS * 1000): ShiftPhase {
  const left = endsAt - now;
  if (left <= 0) return celebrating ? 'countdown' : 'resetting';
  if (left <= countdownMs) return 'countdown';
  if (left <= warnMs) return 'warning';
  return 'running';
}

export function shiftEndsAt(startedAt: number, lengthMs: number): number {
  return startedAt + lengthMs;
}

export function nextEpoch(epoch: number): number {
  return epoch + 1;
}
