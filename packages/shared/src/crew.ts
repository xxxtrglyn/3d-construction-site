import { CREW } from './constants.ts';
import type { JoinMode, RequestResult } from './protocol.ts';

/** One crew member (data-model.md → Crew). `pid` is null while the member is not connected. */
export interface CrewMember {
  keyHash: string;
  pid: string | null;
  name: string;
  hatColor: string;
  joinedAt: number;
  role: 'host' | 'member';
}

export interface CrewRecord {
  members: CrewMember[];
  joinMode: JoinMode;
}

export type MemberStatus = 'active' | 'away' | 'idle';

export interface JoinCheck {
  alreadyInCrew: boolean;
  /** time until which this requester may not ask this crew again (deny/remove cooldown) */
  cooldownUntil: number;
  /** the Host has hidden this requester (answered as "busy", never revealed) */
  hiddenByHost: boolean;
  now: number;
}

/** Outcome of asking to join (before any Host decision). */
export function requestJoin(crew: CrewRecord, c: JoinCheck): Extract<RequestResult, 'joined' | 'pending' | 'closed' | 'full' | 'cooldown' | 'alreadyInCrew' | 'busy'> {
  if (c.alreadyInCrew) return 'alreadyInCrew';
  if (crew.joinMode === 'solo') return 'closed';
  if (crew.members.length >= CREW.maxSize) return 'full';
  if (c.now < c.cooldownUntil) return 'cooldown';
  if (c.hiddenByHost) return 'busy';
  return crew.joinMode === 'open' ? 'joined' : 'pending';
}

export function hostOf(crew: CrewRecord): CrewMember | undefined {
  return crew.members.find((m) => m.role === 'host');
}

/** Next Host: oldest joinedAt among active members (excluding `except`), else the oldest member. */
export function nextHost(crew: CrewRecord, status: (m: CrewMember) => MemberStatus, except?: CrewMember): CrewMember | undefined {
  const others = crew.members.filter((m) => m !== except).sort((a, b) => a.joinedAt - b.joinedAt);
  return others.find((m) => status(m) === 'active') ?? others[0];
}

/** Whether the Host should hand over automatically (away too long, or idle while others are active). */
export function shouldHandOver(crew: CrewRecord, status: (m: CrewMember) => MemberStatus, hostAwayTooLong: boolean): boolean {
  const host = hostOf(crew);
  if (!host) return crew.members.length > 0;
  if (crew.members.length < 2) return false;
  if (hostAwayTooLong) return true;
  return status(host) === 'idle' && crew.members.some((m) => m !== host && status(m) === 'active');
}

/** Makes `to` the Host (the old Host becomes a member). */
export function setHost(crew: CrewRecord, to: CrewMember): void {
  for (const m of crew.members) m.role = m === to ? 'host' : 'member';
}

export function removeMember(crew: CrewRecord, m: CrewMember): void {
  const i = crew.members.indexOf(m);
  if (i >= 0) crew.members.splice(i, 1);
}
