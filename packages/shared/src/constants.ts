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
