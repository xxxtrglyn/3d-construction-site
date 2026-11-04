import type { Client, Deferred } from '@colyseus/core';
import type { Bucket, MachineId, MachineState, MoveInput, RateClass, StrikeWindow, WorkerState } from '@hht/shared';

export interface ChatLine {
  text: string;
  channel: 'nearby' | 'crew';
  at: number;
}

/** Authoritative per-player state (data-model.md → PlayerSession). `pid` is the public id. */
export interface Session {
  pid: string;
  netId: number;
  keyHash: string;
  name: string;
  hatColor: string;
  client: Client | null;
  state: 'active' | 'away';
  reconnect: Deferred<Client> | null;
  awaySince: number;
  /** a second tab of the same device: never resumes crew roles */
  duplicate: boolean;
  worker: WorkerState;
  inputs: MoveInput[];
  lastSeq: number;
  hasSeq: boolean;
  heldPieceId: number | null;
  crewPlot: number;
  crewRole: '' | 'host' | 'member';
  delivered: number;
  donated: number;
  joinedAt: number;
  lastActiveAt: number;
  buckets: Record<RateClass, Bucket>;
  strikes: StrikeWindow;
  lastSlowDownAt: number;
  /** interest tier (0 = unseen, else 1–3) of every other entity, indexed by netId (≤ 0xffff) */
  tiers: Uint8Array;
  /** players this session hid (only used to filter join requests) */
  hidden: Set<string>;
  emoteUntil: number;
  bytesSent: number;
  /** when the client's send buffer first exceeded 1 MB (0 = fine) */
  slowSince: number;
  recentChat: ChatLine[];
  lastChatNorm: Map<string, number>;
  reportedThisShift: Set<string>;
  // feature 003
  /** the machine this session operates, or -1 */
  machine: MachineId | -1;
  /** last machine input with movement or an action (idle put-out, MACHINE.idleExitS) */
  lastMachineInputAt: number;
  /** times (ms) of the last accepted `act` edges (cap MACHINE.actPerSecond) */
  actTimes: number[];
  /** per machine: interest tier (0 = unseen), hash of the last record sent, and the tick it was sent */
  machineTiers: Uint8Array;
  machineHash: Int32Array;
  machineSentTick: Int32Array;
  /** bumped by every teleport/respawn (the workerMovedByMachine audit ignores those) */
  teleports: number;
}

/** A machine held by the server (data-model §5); its operator is a session pid or ''. */
export interface MachineRec {
  state: MachineState;
  operator: string;
}
