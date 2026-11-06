import { describe, it, expect } from 'vitest';
import { selectGuidance, type GuidanceContext } from '../src/guidance.ts';
import { initialProgress } from '../src/progression.ts';
const base: GuidanceContext = { mode: 'solo', connected: true, hidden: false, progress: initialProgress(), held: null, machine: null, occupied: [], mixerBags: 0, mixing: false };
describe('guidance priority and permissions', () => {
  it('starts at excavation in solo and Foreman without a multiplayer crew', () => {
    expect(selectGuidance(base)?.target).toEqual({ kind: 'machine', machine: 'excavator' });
    expect(selectGuidance({ ...base, mode: 'multiplayer', progress: null })?.target.kind).toBe('foreman');
  });
  it('never sends a visitor to a crew machine and suggests donations when all plots are taken', () => {
    expect(selectGuidance({ ...base, mode: 'multiplayer', progress: null, allPlotsBusy: true, donationPlot: 2, held: 'cement' })?.target).toEqual({ kind: 'bin', plot: 2 });
  });
  it('clears hidden, disconnected and completed targets', () => {
    expect(selectGuidance({ ...base, hidden: true })).toBeNull();
    expect(selectGuidance({ ...base, connected: false })).toBeNull();
    expect(selectGuidance({ ...base, progress: { ...initialProgress(), completedStages: 6 } })).toBeNull();
  });
  it('prioritizes carried cement over unoccupied excavator', () => {
    expect(selectGuidance({ ...base, held: 'cement' })?.target.kind).toBe('hopper');
  });
  it('offers useful hand preparation while digging is occupied', () => {
    expect(selectGuidance({ ...base, occupied: ['excavator'] })?.material).toBe('cement');
    expect(selectGuidance({ ...base, occupied: ['excavator', 'mixer'], mixerBags: 4 })?.target.kind).toBe('none');
  });
});

it('offers mixing staged cement before digging ends when the mixer is free', () => {
  expect(selectGuidance({ ...base, occupied: ['excavator'], mixerBags: 4 })?.target).toEqual({kind:'machine',machine:'mixer'});
});
it('does not direct surplus concrete into a finished footing', () => {
  expect(selectGuidance({ ...base, progress: {...initialProgress(), groundDug:6, groundPoured:4}, held:'concrete' })?.target.kind).toBe('none');
});
