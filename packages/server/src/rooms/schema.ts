import { schema, t, type SchemaType } from '@colyseus/schema';

/** Low-frequency synced state (contracts/network-protocol.md §3). Worker transforms go in binary snapshots. */
export const PlayerState = schema(
  {
    netId: t.uint16(),
    name: t.string(),
    hatColor: t.string(),
    /** '' or a PieceTypeId */
    heldType: t.string(),
    crewPlot: t.int8().default(-1),
    /** '' | 'host' | 'member' */
    crewRole: t.string(),
    away: t.boolean(),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const PlotState = schema(
  {
    /** 'free' | 'building' | 'unattended' | 'finished' */
    state: t.string().default('free'),
    blueprintId: t.string(),
    completedStages: t.uint8(),
    filledSlots: t.uint8(),
    hostName: t.string(),
    hostSession: t.string(),
    joinMode: t.string().default('ask'),
    crewSize: t.uint8(),
    bin: t.array('string'),
    finishedAt: t.float64(),
  },
  'PlotState',
);
export type PlotState = SchemaType<typeof PlotState>;

export const PieceState = schema(
  {
    type: t.string(),
    /** 'loose' | 'flying' */
    state: t.string(),
    x: t.float32(),
    y: t.float32(),
    z: t.float32(),
    ox: t.float32(),
    oy: t.float32(),
    oz: t.float32(),
    vx: t.float32(),
    vy: t.float32(),
    vz: t.float32(),
    t0: t.float64(),
    landAt: t.float64(),
  },
  'PieceState',
);
export type PieceState = SchemaType<typeof PieceState>;

export const ShiftState = schema(
  {
    epoch: t.uint32(),
    endsAt: t.float64(),
    towersCompleted: t.uint16(),
    /** 'running' | 'warning' | 'countdown' | 'resetting' */
    phase: t.string().default('running'),
  },
  'ShiftState',
);
export type ShiftState = SchemaType<typeof ShiftState>;

export const WorldState = schema(
  {
    worldId: t.uint16(),
    shift: ShiftState,
    players: t.map(PlayerState),
    plots: t.array(PlotState),
    pieces: t.map(PieceState),
  },
  'WorldState',
);
export type WorldState = SchemaType<typeof WorldState>;
