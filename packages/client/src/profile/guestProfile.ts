import { generateName, isHatColorId, isValidGuestName, randomHatColor, type HatColorId, type MachineKind, type Rng } from '@hht/shared';

export const PROFILE_KEY = 'hht.profile.v2';
export const LEGACY_PROFILE_KEY = 'hht.profile.v1';

export interface GuestProfile {
  version: 2;
  /** generated from the shared word lists; 3–20 chars; never free text */
  name: string;
  hatColor: HatColorId;
  muted: boolean;
  hintsDone: { firstPickup: boolean; firstSnap: boolean };
  createdAt: string;
  /** 128-bit device secret (32 hex chars): the spec's "reconnect token"; never shown */
  playerKey: string;
  /** world joined last (rejoin after reload/restart) */
  lastWorld: number | null;
  /** hide all typed chat (FR-064) */
  hideAllChat: boolean;
  /** feature 003: machine kinds whose control hint card this device has seen (optional: older profiles lack it) */
  seenMachineHints?: MachineKind[];
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

const KEY_RE = /^[0-9a-f]{32}$/;

/** 128-bit random key: crypto when available (tests pass a seeded rng for determinism). */
export function newPlayerKey(rng?: Rng): string {
  const bytes = new Uint8Array(16);
  if (!rng && typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor((rng ?? Math.random)() * 256) & 255;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newProfile(rng: Rng = Math.random): GuestProfile {
  return {
    version: 2,
    playerKey: newPlayerKey(rng === Math.random ? undefined : rng),
    lastWorld: null,
    hideAllChat: false,
    name: generateName(rng),
    hatColor: randomHatColor(rng),
    muted: false,
    hintsDone: { firstPickup: false, firstSnap: false },
    createdAt: new Date().toISOString(),
  };
}

type V1Profile = Omit<GuestProfile, 'version' | 'playerKey' | 'lastWorld' | 'hideAllChat'> & { version: 1 };

function isV1(v: unknown): v is V1Profile {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<V1Profile>;
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

function isProfile(v: unknown): v is GuestProfile {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<GuestProfile>;
  return (
    p.version === 2 &&
    typeof p.playerKey === 'string' &&
    KEY_RE.test(p.playerKey) &&
    (p.lastWorld === null || (typeof p.lastWorld === 'number' && Number.isInteger(p.lastWorld) && p.lastWorld > 0)) &&
    typeof p.hideAllChat === 'boolean' &&
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
      if (!loaded) {
        // migrate the 001 profile (v1): keep name, hat, mute and hints; add the new fields
        const legacy = this.storage?.getItem(LEGACY_PROFILE_KEY) ?? null;
        const parsed: unknown = legacy ? JSON.parse(legacy) : null;
        if (isV1(parsed)) loaded = { ...parsed, version: 2, playerKey: newPlayerKey(rng === Math.random ? undefined : rng), lastWorld: null, hideAllChat: false };
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

  update(patch: Partial<Omit<GuestProfile, 'version' | 'createdAt' | 'playerKey'>>): Readonly<GuestProfile> {
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
