import { MACHINE } from './constants.ts';
import { blueprintOf, groundworkPart, neededSupplies, openSlots, openSlotsOf, type TowerProgress } from './progression.ts';
import { forkliftLoadCount, type MachineKind, type MachineState } from './machines.ts';
import { PIECE_TYPES, type PieceTypeId } from './pieces.ts';

export type GuidanceTarget = { kind: 'machine'; machine: MachineKind } | { kind: 'rack'; material: PieceTypeId } | { kind: 'bin'; plot: number } | { kind: 'foreman' | 'hopper' | 'spoil' | 'pit' | 'slot' | 'chute' | 'pad' | 'none' };
export interface GuidanceSuggestion { key: string; text: string; target: GuidanceTarget; material?: PieceTypeId }
export interface GuidanceContext {
  mode: 'solo' | 'multiplayer'; connected: boolean; hidden: boolean;
  progress: TowerProgress | null; held: PieceTypeId | null;
  machine: MachineState | null; occupied: readonly MachineKind[];
  mixerBags: number; mixing: boolean;
  concreteAvailable?: boolean;
  allPlotsBusy?: boolean; donationPlot?: number;
}
const suggestion = (key: string, text: string, target: GuidanceTarget, material?: PieceTypeId): GuidanceSuggestion => ({ key, text, target, ...(material ? { material } : {}) });
const machine = (kind: MachineKind, text: string) => suggestion(kind, text, { kind: 'machine', machine: kind });
const supply = (type: PieceTypeId) => suggestion('supply', `Fetch ${PIECE_TYPES[type].label} from the rack`, { kind: 'rack', material: type }, type);
const busy = () => suggestion('busy', 'Your crew is working — explore or lend a hand nearby', { kind: 'none' });
/** The stage material to fetch next: the first still-needed one (mixed-material 004: recipe order). */
const stageNeed = (p: TowerProgress): PieceTypeId => neededSupplies(p)[0] ?? blueprintOf(p).stages[p.completedStages]?.pieceType ?? 'beam';

/** Advisory only: existing authoritative operations always decide whether work is permitted. */
export function selectGuidance(c: GuidanceContext): GuidanceSuggestion | null {
  if (c.hidden || !c.connected) return null;
  const p = c.progress;
  if (!p) {
    if (c.mode === 'solo') return null;
    if (c.allPlotsBusy && c.donationPlot !== undefined && c.donationPlot >= 0 && c.held && c.held !== 'cone' && c.held !== 'concrete') return suggestion('donate', 'Help this crew: drop your material in its supply bin', { kind: 'bin', plot: c.donationPlot });
    return suggestion('foreman', c.allPlotsBusy ? 'Talk to the Foreman to join a crew, or carry cement to a supply bin' : 'Talk to the Foreman to start or join a building', { kind: 'foreman' });
  }
  const bp = blueprintOf(p);
  if (p.completedStages >= bp.stages.length) return null;
  const part = groundworkPart(p, bp);
  const s = c.machine;
  if (s) {
    if (s.kind === 'excavator') return part !== 'dig' ? suggestion('dug', 'Pit complete — get out and help with concrete', { kind: 'none' }) : s.load.kind === 'dirt' ? suggestion('dump', 'Carry the dirt to the spoil heap and dump it', { kind: 'spoil' }) : suggestion('dig', 'Move the bucket over the pit and scoop', { kind: 'pit' });
    if (s.kind === 'mixer') return c.mixing ? suggestion('mixing', 'Mixing — concrete will appear at the chute', { kind: 'chute' }) : c.mixerBags ? suggestion('mix', `Mix ${c.mixerBags} cement bags`, { kind: 'hopper' }) : supply('cement');
    if (s.kind === 'crane' && s.load.kind === 'hook' && (part === 'dig' || (part === 'concrete' ? s.load.piece !== 'concrete' : !neededSupplies(p, bp).includes(s.load.piece)))) return suggestion('wrong-hook', 'Set this load back on the striped pad; it cannot fill the current step', { kind: 'pad' });
    if (s.kind === 'crane') return s.load.kind === 'hook' ? suggestion('lift', 'Move the load to a lit slot, then release', { kind: 'slot' }) : suggestion('grab', 'Stage a needed piece on the striped pad, then grab it', { kind: 'pad' });
    if (s.load.kind === 'pallet') return suggestion('unload', `Pallet ${s.load.pieces.length}/${MACHINE.forklift.palletMax} — ${s.load.pieces[0] === 'cement' ? 'drive to the mixer hopper; excess lands safely on the ground' : 'drive to your plot; unplaced pieces land on the ground'}`, { kind: s.load.pieces[0] === 'cement' ? 'hopper' : 'slot' });
    if (part) return forkliftLoadCount(p, 'cement', c.mixerBags, bp) > 0 ? supply('cement') : busy();
    const loadable = neededSupplies(p, bp).filter((t) => forkliftLoadCount(p, t, c.mixerBags, bp) > 0);
    return supply(loadable.reduce((a, t) => (forkliftLoadCount(p, t, c.mixerBags, bp) > forkliftLoadCount(p, a, c.mixerBags, bp) ? t : a), loadable[0] ?? stageNeed(p)));
  }
  if (c.held) {
    if (c.held === 'cement') return c.mixing || c.mixerBags >= MACHINE.mixer.capacity ? suggestion('full', 'Mixer busy/full — set the bag on the ground beside it', { kind: 'none' }) : suggestion('hopper', 'Drop the cement bag into the mixer hopper', { kind: 'hopper' });
    if (c.held === 'concrete' && part === null) return suggestion('extra-concrete', 'The footing is complete — set this bucket aside', { kind: 'none' });
    if (c.held === 'concrete') return part === 'dig' ? suggestion('wait-dig', 'Set the bucket aside; finish digging before pouring', { kind: 'pit' }) : suggestion('pour', 'Carry concrete to the footing', { kind: 'pit' });
    if (part) return suggestion('stage', 'Set this piece aside; finish the groundwork first', { kind: 'none' });
    if (!neededSupplies(p, bp).includes(c.held)) return suggestion('wrong', `Set this piece aside; fetch ${PIECE_TYPES[stageNeed(p)].label}`, { kind: 'rack', material: stageNeed(p) });
    return openSlotsOf(p, c.held, bp).ordinary > 0 ? suggestion('place', 'Carry this piece into your building zone', { kind: 'slot' }) : suggestion('high', 'Stage this piece on the striped pad for the crane', { kind: 'pad' });
  }
  if (part === 'dig') {
    if (!c.occupied.includes('excavator')) return machine('excavator', `Dig ${p.groundDug}/${bp.groundwork.scoops} — use the excavator`);
    if (c.mixerBags > 0 && !c.mixing && !c.occupied.includes('mixer')) return machine('mixer', 'Prepare concrete in the mixer while your crew digs');
    return c.mixerBags < MACHINE.mixer.capacity && !c.mixing ? supply('cement') : busy();
  }
  if (part === 'concrete') {
    if (c.mixing) return suggestion('chute', 'Wait for concrete at the mixer chute', { kind: 'chute' });
    if (c.mixerBags && !c.occupied.includes('mixer')) return machine('mixer', 'Use the mixer to make concrete');
    return c.concreteAvailable ? suggestion('concrete', 'Carry concrete from the chute to the footing', { kind: 'chute' }) : supply('cement');
  }
  if (openSlots(p, bp).hand === 0 && !c.occupied.includes('crane')) return machine('crane', 'Use the crane for the remaining high slots');
  return supply(stageNeed(p));
}
