import { it, expect } from 'vitest';
import { forkliftLoadCount } from '../src/machines.ts';
import { initialProgress, pour } from '../src/progression.ts';
it('prepares cement while digging without authorizing pouring', () => {
 const p = initialProgress();
 expect(forkliftLoadCount(p, 'cement', 0)).toBe(4);
 expect(forkliftLoadCount(p, 'cement', 3)).toBe(1);
 expect(forkliftLoadCount(p, 'cement', 4)).toBe(0);
 expect(forkliftLoadCount(p, 'beam', 0)).toBe(0);
 expect(pour(p).result).toBe('notDug');
});
it('keeps stage eligibility, capacity and completed-work bounds', () => {
 const p = { ...initialProgress(), groundDug: 6, groundPoured: 4 };
 expect(forkliftLoadCount(p, 'beam', 0)).toBe(4);
 expect(forkliftLoadCount(p, 'cement', 0)).toBe(0);
 expect(forkliftLoadCount({ ...p, filledSlots: 5 }, 'beam', 0)).toBe(1);
 expect(forkliftLoadCount({ ...p, completedStages: 6 }, 'bell', 0)).toBe(0);
 expect(forkliftLoadCount(p, 'cone', 0)).toBe(0);
});

it('describes actual hopper capacity and safe overflow before unloading', async () => {
 const { forkliftUnloadLabel, parkedState, FORK_REACH } = await import('../src/machines.ts');
 const { SITE } = await import('../src/index.ts');
 const spots = SITE.machines[0]!;
 const s = { ...parkedState(2, spots), x: spots.mixer.hopper.x, z: spots.mixer.hopper.z - FORK_REACH, yaw: 0, load: { kind: 'pallet' as const, pieces: ['cement', 'cement', 'cement', 'cement'] as const } };
 expect(forkliftUnloadLabel(s, SITE, 0, initialProgress(), 3, false)).toContain('1 to hopper; 3 on the ground');
 expect(forkliftUnloadLabel(s, SITE, 0, initialProgress(), 0, true)).toContain('on the ground');
});
