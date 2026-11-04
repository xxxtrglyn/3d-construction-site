export type QualityTier = 'high' | 'low';

export interface QualitySettings {
  readonly tier: QualityTier;
  readonly maxPixelRatio: number;
  readonly shadowMapSize: number;
  readonly outlines: boolean;
  /** outlines fade out beyond this camera distance (meters) */
  readonly outlineDistance: number;
  readonly outlineWidthPx: number;
  readonly bloom: boolean;
  /** multiplier for particle counts in celebrations */
  readonly particles: number;
}

export const QUALITY: Readonly<Record<QualityTier, QualitySettings>> = {
  high: { tier: 'high', maxPixelRatio: 2, shadowMapSize: 2048, outlines: true, outlineDistance: 28, outlineWidthPx: 1.6, bloom: true, particles: 1 },
  low: { tier: 'low', maxPixelRatio: 1.5, shadowMapSize: 1024, outlines: false, outlineDistance: 0, outlineWidthPx: 0, bloom: false, particles: 0.45 },
};

/** Pick a tier from URL override (?q=high|low) or simple device hints. */
export function detectQuality(search: string = location.search, nav: Navigator = navigator): QualitySettings {
  const q = new URLSearchParams(search).get('q');
  if (q === 'high' || q === 'low') return QUALITY[q];
  const mem = (nav as Navigator & { deviceMemory?: number }).deviceMemory;
  const touchFirst = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const smallScreen = typeof screen !== 'undefined' && Math.min(screen.width, screen.height) < 600;
  if ((mem !== undefined && mem <= 4) || (touchFirst && smallScreen)) return QUALITY.low;
  return QUALITY.high;
}
