/** Gameplay tuning shared by client (and later the server). Units: meters, seconds. */
export const MOVE = {
  walkSpeed: 3.2,
  runSpeed: 5.5,
  jumpApex: 1.1,
  /** fraction of speed lost while carrying heavy pieces (beam, bell) */
  carrySlowdown: 0.15,
  gravity: 22,
} as const;

export const INTERACT = {
  pickupRadius: 1.2,
  /** full cone angle in degrees in front of the worker */
  pickupConeDeg: 120,
  /** around the tower center; the tower is exported at 1.6× scale (footprint half ≈ 1.36 m) */
  buildZoneRadius: 3.0,
  /** hold the action button at least this long to toss instead of drop */
  tossHoldSeconds: 0.35,
} as const;

export const LOOSE = {
  fadeAfterSeconds: 60,
  maxLoose: 30,
  respawnBelowY: -5,
} as const;

// ---------------------------------------------------------------- multiplayer (feature 002)

/** Loose pieces in a multiplayer world (solo keeps LOOSE.maxLoose = 30). */
export const LOOSE_MP = { maxLoose: 150, fadeAfterSeconds: 60 } as const;

export const CREW = {
  maxSize: 8,
  requestExpireS: 30,
  denyCooldownS: 60,
  hostAwayS: 60,
  hostIdleS: 300,
  unattendedAfterS: 180,
} as const;

export const PLOTS = { count: 12, retireAfterFinishedS: 600, celebrateS: 8 } as const;

export const SHIFT = { defaultMinutes: 60, warnS: 300, countdownS: 30 } as const;

export const NET = {
  tickMs: 50,
  patchMs: 100,
  simHz: 60,
  reconnectGraceS: 60,
  bootGraceS: 120,
  idleKickS: 600,
  /** interest tier radii (m): ≤ 15 → tier 1 (20 Hz), ≤ 35 → tier 2 (10 Hz), else tier 3 (4 Hz) */
  tiers: [15, 35],
  hysteresisM: 2,
  interpDelayMs: [100, 180, 320],
  extrapolateMaxMs: 200,
  /** reconciliation threshold (m) */
  correctionEpsilon: 0.02,
  correctionBlendMs: 150,
  /** grab range tolerance on top of INTERACT.pickupRadius (m) */
  grabSlack: 0.3,
} as const;

export const CHAT = {
  maxLen: 80,
  nearbyM: 20,
  unlockAfterS: 60,
  duplicateWindowS: 30,
  logLines: 50,
  ringSize: 5,
  pauseReporters: 3,
  pauseWindowS: 600,
  reportRetentionDays: 30,
  bubbleS: 5,
  maxBubbles: 12,
} as const;

export const SOCIAL = { emoteRadiusM: 35, showS: 3 } as const;

export const BIN = { capacity: 10 } as const;

// ---------------------------------------------------------------- construction machines (feature 003)

/**
 * Machine tuning (research M8). Starting values, tuned in playtests: change them only here (and in
 * the spec's assumption list). Units: meters, seconds, radians.
 */
export const MACHINE = {
  /** max distance from the cab (crane: the mast base) to get in */
  enterRange: 1.5,
  /** an operator with no input for this long is put out */
  idleExitS: 60,
  /** `act` edges per second beyond this are ignored (no strike) */
  actPerSecond: 4,
  excavator: { speed: 2.8, turnRate: 1.6, scoopS: 0.9, dumpS: 0.7, pitReach: 1.2, spoilReach: 1.5 },
  forklift: { speed: 6.5, steerMax: 0.6, pivotRate: 1.6, rackReach: 1.0, palletMax: 4 },
  crane: { slewRate: 0.9, trolleySpeed: 3.0, reachMin: 2.5, reachMax: 7.5, hookS: 1.0, grabRadius: 0.8, snapRadius: 1.5 },
  mixer: { capacity: 4, mixS: 5 },
  groundwork: { scoops: 6, concrete: 4 },
  /** an unchanged machine record is re-sent to a receiver after this long */
  keyframeS: 2,
  /** set-down search radius for pieces released by a machine */
  setDownRadius: 2,
} as const;
