import type { HintEvent, Need, PieceTypeId } from '@hht/shared';
import { PALETTE } from '../render/palette.gen.ts';

/**
 * Feature 004: the only source of "what is needed" text (contracts/needs-display.md). Every line is a
 * fixed template (constitution Principle V: no free text). The sign, the HUD, the Foreman and the hint
 * toasts all render `needsOf()` through these helpers, so they always agree (US2).
 */

/** [singular, plural] nouns per piece type. */
const NOUN: Record<PieceTypeId, readonly [string, string]> = {
  beam: ['beam', 'beams'],
  brick: ['brick', 'bricks'],
  panel: ['panel', 'panels'],
  paint: ['paint bucket', 'paint buckets'],
  decor: ['decor crate', 'decor crates'],
  bell: ['golden bell', 'golden bells'],
  cone: ['cone', 'cones'],
  cement: ['cement bag', 'cement bags'],
  concrete: ['concrete bucket', 'concrete buckets'],
};

/** Palette entry of each piece's main colour (the art palette, so dots match the models). */
const PIECE_COLOR: Record<PieceTypeId, string> = {
  beam: 'beam', brick: 'brick', panel: 'teal', paint: 'purple', decor: 'pink', bell: 'gold', cone: 'orange', cement: 'concrete', concrete: 'stone',
};
const css = (rgb: readonly number[] | undefined): string =>
  rgb ? `rgb(${Math.round((rgb[0] ?? 0) * 255)}, ${Math.round((rgb[1] ?? 0) * 255)}, ${Math.round((rgb[2] ?? 0) * 255)})` : '#ccc';

/** Piece colour dots (shared by the sign, the HUD and the chips). */
export const PIECE_DOT = Object.fromEntries(
  Object.entries(PIECE_COLOR).map(([t, c]) => [t, css(PALETTE[c as keyof typeof PALETTE] as readonly number[] | undefined)]),
) as Record<PieceTypeId, string>;

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** "1 beam", "2 beams". */
export const countNoun = (type: PieceTypeId, n: number): string => `${n} ${NOUN[type][n === 1 ? 0 : 1]}`;
/** "beams" (the material in general). */
export const pluralNoun = (type: PieceTypeId): string => NOUN[type][1];

/** "beams and bricks", "beams". */
const listNouns = (types: readonly PieceTypeId[]): string => {
  const words = types.map(pluralNoun);
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
};

const dot = (type: PieceTypeId): string => `<span class="dot" style="background:${PIECE_DOT[type]}"></span>`;

/** One chip per material: `● Beams 3`, `● Panels 3 🏗️` (crane only), `● Bricks ✓` (done, dimmed). */
export function chipHtml(n: Need): string {
  const label = cap(pluralNoun(n.type));
  if (n.done) return `<span class="need done">${dot(n.type)}${label} ✓</span>`;
  const crane = n.craneOnly ? ' <span class="crane" title="use the crane" aria-label="use the crane">🏗️</span>' : '';
  return `<span class="need">${dot(n.type)}${label} <b>${n.left}</b>${crane}</span>`;
}

/** All chips of a stage, separated by thin dots. */
export const chipsHtml = (needs: readonly Need[]): string => needs.map(chipHtml).join('<span class="sep"> · </span>');

/** Plain-text needs (aria labels, tests): "Beams 3 · Bricks ✓". */
export const chipsText = (needs: readonly Need[]): string =>
  needs.map((n) => `${cap(pluralNoun(n.type))} ${n.done ? '✓' : `${n.left}${n.craneOnly ? ' 🏗️' : ''}`}`).join(' · ');

/** The Foreman's one line for a crew member (contracts/needs-display.md "Foreman lines"); null when nothing is left. */
export function foremanLine(needs: readonly Need[]): string | null {
  const open = needs.filter((n) => !n.done);
  if (open.length === 0) return null;
  if (open.every((n) => n.craneOnly)) return `Only the crane can finish this: ${open.map((n) => countNoun(n.type, n.left)).join(' and ')} up top!`;
  if (open.length === 1) return `Just ${countNoun(open[0]!.type, open[0]!.left)} to go!`;
  return `Bring ${open.map((n) => countNoun(n.type, n.left)).join(' and ')}!`;
}

/** Toast text for a refused delivery (contracts/needs-display.md "Hint lines"); null for hints this module does not phrase. */
export function hintLine(h: HintEvent, stageName: string | null): string | null {
  const stage = stageName ? `the ${stageName}` : 'this tower';
  switch (h.kind) {
    case 'wrongPiece':
      return h.needed.length ? `${cap(stage)} needs ${listNouns(h.needed)} now` : 'Not needed here';
    case 'surplus':
      return h.needed.length ? `Enough ${pluralNoun(h.type)}, ${stage} needs ${listNouns(h.needed)} now` : `Enough ${pluralNoun(h.type)}!`;
    case 'binNotNeeded':
      return h.needed.length ? `This plot has enough ${pluralNoun(h.type)}: try ${listNouns(h.needed)}` : `This plot has enough ${pluralNoun(h.type)}`;
    case 'tooHigh':
      return 'Too high: use the crane';
    default:
      return null;
  }
}
