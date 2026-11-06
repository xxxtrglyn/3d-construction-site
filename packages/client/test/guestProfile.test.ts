import { describe, expect, it } from 'vitest';
import { isValidGuestName, seededRng } from '@hht/shared';
import { LEGACY_PROFILE_KEY, PROFILE_KEY, ProfileStore, type StorageLike } from '../src/profile/guestProfile.ts';

class MemStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

describe('ProfileStore', () => {
  it('generates and persists a profile on first run', () => {
    const s = new MemStorage();
    const store = new ProfileStore(s, seededRng(1));
    const p = store.get();
    expect(isValidGuestName(p.name)).toBe(true);
    expect(p.version).toBe(2);
    expect(p.playerKey).toMatch(/^[0-9a-f]{32}$/);
    expect(p.lastWorld).toBeNull();
    expect(p.hideAllChat).toBe(false);
    expect(p.hintsDone).toEqual({ firstPickup: false, firstSnap: false });
    expect(JSON.parse(s.getItem(PROFILE_KEY) as string).name).toBe(p.name);
    expect(store.persistent).toBe(true);
  });

  it('migrates a v1 profile, keeping name, hat, mute and hints', () => {
    const s = new MemStorage();
    s.setItem(LEGACY_PROFILE_KEY, JSON.stringify({ version: 1, name: 'Sunny Bolt', hatColor: 'pink', muted: true, hintsDone: { firstPickup: true, firstSnap: false }, createdAt: '2026-11-01T00:00:00Z' }));
    const p = new ProfileStore(s, seededRng(5)).get();
    expect(p).toMatchObject({ version: 2, name: 'Sunny Bolt', hatColor: 'pink', muted: true, hintsDone: { firstPickup: true, firstSnap: false }, lastWorld: null, hideAllChat: false });
    expect(p.playerKey).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.parse(s.getItem(PROFILE_KEY) as string).playerKey).toBe(p.playerKey);
  });

  it('keeps the same player key across visits', () => {
    const s = new MemStorage();
    const a = new ProfileStore(s, seededRng(6)).get().playerKey;
    const b = new ProfileStore(s, seededRng(7)).get().playerKey;
    expect(b).toBe(a);
  });

  it('remembers the same name and hat color on the next visit', () => {
    const s = new MemStorage();
    const first = new ProfileStore(s, seededRng(2)).get();
    const second = new ProfileStore(s, seededRng(99)).get();
    expect(second.name).toBe(first.name);
    expect(second.hatColor).toBe(first.hatColor);
  });

  it('regenerates on corrupt or invalid data', () => {
    const s = new MemStorage();
    s.setItem(PROFILE_KEY, '{not json');
    expect(isValidGuestName(new ProfileStore(s, seededRng(3)).get().name)).toBe(true);
    s.setItem(PROFILE_KEY, JSON.stringify({ version: 1, name: 'free text name', hatColor: 'yellow', muted: false, hintsDone: { firstPickup: true, firstSnap: true }, createdAt: 'x' }));
    expect(new ProfileStore(s, seededRng(4)).get().name).not.toBe('free text name');
  });

  it('falls back to memory when storage throws', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const store = new ProfileStore(broken, seededRng(5));
    expect(store.persistent).toBe(false);
    expect(store.update({ muted: true }).muted).toBe(true);
  });

  it('works without any storage', () => {
    const store = new ProfileStore(null, seededRng(6));
    expect(store.persistent).toBe(false);
    expect(isValidGuestName(store.shuffleName(seededRng(7)))).toBe(true);
  });
});

it('normalizes machine learning without replacing identity or promoting seen hints', () => {
  const storage = new MemStorage();
  const original = new ProfileStore(storage).get();
  storage.setItem(PROFILE_KEY, JSON.stringify({ ...original, seenMachineHints: ['crane'], completedMachineHints: ['forklift', 'bogus', 'forklift'], guidanceHidden: 'yes' }));
  const profile = new ProfileStore(storage).get();
  expect(profile.playerKey).toBe(original.playerKey);
  expect(profile.completedMachineHints).toEqual(['forklift']);
  expect(profile.guidanceHidden).toBe(false);
});
