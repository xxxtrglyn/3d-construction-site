import { PIECE_TYPES, type MachineKind, type PieceTypeId, type Via } from '@hht/shared';
export interface ConfirmedFeedback { act: string; by?: string | null; via?: Via; plot?: number; id?: number }
/** Only confirmed outcomes belong here. Unknown actor attribution never teaches a machine. */
export function learnedMachine(e: ConfirmedFeedback, me: string): MachineKind | null {
  if (!e.by || e.by !== me) return null;
  if (e.act === 'snap' && e.via === 'crane') return 'crane';
  return ({ dump: 'excavator', palletLoad: 'forklift', mixStart: 'mixer' } as Record<string, MachineKind>)[e.act] ?? null;
}
export function recoveryText(reason: string, needed?: PieceTypeId | null, part?: string): string {
  switch (reason) {
    case 'wrongPiece': return needed ? `Set this aside; fetch ${PIECE_TYPES[needed].label} from its rack` : 'This building is finished — help another crew or explore';
    case 'tooHigh': return 'Too high — stage the piece on the striped pad and use the crane';
    case 'groundworkFirst': return part === 'dig' ? 'Finish digging with the excavator before pouring or building' : 'Pour concrete into the footing before adding building pieces';
    case 'binFull': return 'Supply bin full — keep the material or help another building';
    case 'mixerFull': return 'Mixer busy/full — set extra bags on the ground beside it';
    case 'notCrew': case 'crewOnlyMachine': case 'notBuilding': return 'Join this crew through the Foreman, or help through its supply bin';
    case 'busy': return 'Machine occupied — prepare supplies or choose another useful job';
    case 'handsFull': return 'Put your carried piece down before entering the machine';
    case 'tooFar': return 'Move closer to the machine cab, then try again';
    default: return 'Try again nearby, or open machine help';
  }
}
export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Static confirmation remains available with sound muted and reduced motion enabled. */
export function successText(act: string): string | null {
  return ({ dump: '✓ Dirt delivered to the spoil heap', palletLoad: '✓ Pallet loaded — drive to your destination', mixStart: '✓ Mixing started', snap: '✓ Piece placed' } as Record<string, string>)[act] ?? null;
}
