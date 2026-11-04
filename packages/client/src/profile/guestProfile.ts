import { generateName, isHatColorId, isValidGuestName, randomHatColor, type HatColorId, type Rng } from '@hht/shared';

export const PROFILE_KEY = 'hht.profile.v1';

export interface GuestProfile {
  version: 1;
  /** generated from the shared word lists; 3–20 chars; never free text */
  name: string;
  hatColor: HatColorId;
  muted: boolean;
  hintsDone: { firstPickup: boolean; firstSnap: boolean };
  createdAt: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function newProfile(rng: Rng = Math.random): GuestProfile {
  return {
    version: 1,
    name: generateName(rng),
    hatColor: randomHatColor(rng),
    muted: false,
    hintsDone: { firstPickup: false, firstSnap: false },
    createdAt: new Date().toISOString(),
  };
}

function isProfile(v: unknown): v is GuestProfile {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<GuestProfile>;
  return (
    p.version === 1 &&
    isValidGuestName(p.name) &&
    isHatColorId(p.hatColor) &&
    typeof p.muted === 'boolean' &&
    !!p.hintsDone &&
    typeof p.hintsDone.firstPickup === 'boolean' &&
    typeof p.hintsDone.firstSnap === 'boolean' &&
    typeof p.createdAt === 'string'
  );
}

/** Profile store: persists on the device, falls back to memory when storage is blocked. */
export class ProfileStore {
  private profile: GuestProfile;
  readonly persistent: boolean;

  constructor(private readonly storage: StorageLike | null = safeStorage(), rng: Rng = Math.random) {
    let loaded: GuestProfile | null = null;
    let readable = false;
    try {
      const raw = this.storage?.getItem(PROFILE_KEY) ?? null;
      readable = this.storage !== null;
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isProfile(parsed)) loaded = parsed;
      }
    } catch {
      readable = false;
    }
    this.profile = loaded ?? newProfile(rng);
    this.persistent = readable && this.save();
  }

  get(): Readonly<GuestProfile> {
    return this.profile;
  }

  update(patch: Partial<Omit<GuestProfile, 'version' | 'createdAt'>>): Readonly<GuestProfile> {
    this.profile = { ...this.profile, ...patch, hintsDone: { ...this.profile.hintsDone, ...(patch.hintsDone ?? {}) } };
    this.save();
    return this.profile;
  }

  shuffleName(rng: Rng = Math.random): string {
    let name = generateName(rng);
    for (let i = 0; i < 5 && name === this.profile.name; i++) name = generateName(rng);
    this.update({ name });
    return name;
  }

  private save(): boolean {
    try {
      this.storage?.setItem(PROFILE_KEY, JSON.stringify(this.profile));
      return this.storage !== null;
    } catch {
      return false;
    }
  }
}
