import type { Client, Deferred } from '@colyseus/core';
import type { Bucket, MoveInput, RateClass, StrikeWindow, Tier, WorkerState } from '@hht/shared';

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
  /** interest tier of every other entity as seen by this receiver */
  tiers: Map<number, Tier>;
  /** players this session hid (only used to filter join requests) */
  hidden: Set<string>;
  emoteUntil: number;
  bytesSent: number;
  /** when the client's send buffer first exceeded 1 MB (0 = fine) */
  slowSince: number;
  recentChat: ChatLine[];
  lastChatNorm: Map<string, number>;
  reportedThisShift: Set<string>;
}
