/** Order matters: wire carry codes are the index + 1 (feature 003 appends cement and concrete after cone). */
export type PieceTypeId = 'beam' | 'brick' | 'panel' | 'paint' | 'decor' | 'bell' | 'cone' | 'cement' | 'concrete';

export type CarryPose = 'twoHands' | 'shoulder' | 'hug';

export interface PieceTypeDef {
  readonly id: PieceTypeId;
  readonly label: string;
  readonly iconId: string;
  /** false for cones (fun props) and cement bags (they go into the mixer); concrete fills only the footing */
  readonly fillsSlots: boolean;
  /** gameplay mass; toss distance scales with 1/mass */
  readonly mass: number;
  readonly carryPose: CarryPose;
  readonly collider: { readonly shape: 'box' | 'cylinder'; readonly size: readonly [number, number, number] };
}

export const PIECE_TYPES: Readonly<Record<PieceTypeId, PieceTypeDef>> = {
  beam: { id: 'beam', label: 'Steel beam', iconId: 'beam', fillsSlots: true, mass: 3, carryPose: 'shoulder', collider: { shape: 'box', size: [1.4, 0.16, 0.16] } },
  brick: { id: 'brick', label: 'Bricks', iconId: 'brick', fillsSlots: true, mass: 2, carryPose: 'twoHands', collider: { shape: 'box', size: [0.5, 0.26, 0.36] } },
  panel: { id: 'panel', label: 'Roof & window panel', iconId: 'panel', fillsSlots: true, mass: 2, carryPose: 'twoHands', collider: { shape: 'box', size: [0.6, 0.5, 0.08] } },
  paint: { id: 'paint', label: 'Paint bucket', iconId: 'paint', fillsSlots: true, mass: 1.5, carryPose: 'twoHands', collider: { shape: 'cylinder', size: [0.34, 0.36, 0.34] } },
  decor: { id: 'decor', label: 'Decoration crate', iconId: 'decor', fillsSlots: true, mass: 1.5, carryPose: 'twoHands', collider: { shape: 'box', size: [0.44, 0.38, 0.44] } },
  bell: { id: 'bell', label: 'Golden bell', iconId: 'bell', fillsSlots: true, mass: 3, carryPose: 'hug', collider: { shape: 'cylinder', size: [0.5, 0.5, 0.5] } },
  cone: { id: 'cone', label: 'Traffic cone', iconId: 'cone', fillsSlots: false, mass: 0.6, carryPose: 'twoHands', collider: { shape: 'cylinder', size: [0.32, 0.46, 0.32] } },
  // feature 003 (Groundwork): from the racks into the mixer; mixer output into the footing
  cement: { id: 'cement', label: 'Cement bag', iconId: 'cement', fillsSlots: false, mass: 2, carryPose: 'twoHands', collider: { shape: 'box', size: [0.5, 0.3, 0.35] } },
  concrete: { id: 'concrete', label: 'Concrete bucket', iconId: 'concrete', fillsSlots: true, mass: 2, carryPose: 'twoHands', collider: { shape: 'cylinder', size: [0.36, 0.38, 0.36] } },
};

export const PIECE_TYPE_IDS = Object.keys(PIECE_TYPES) as PieceTypeId[];

export function isPieceTypeId(value: unknown): value is PieceTypeId {
  return typeof value === 'string' && value in PIECE_TYPES;
}
