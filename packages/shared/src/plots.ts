/** Plot/building state machine (data-model.md → Plot and Building). Times in ms. */
export type PlotStateName = 'free' | 'building' | 'unattended' | 'finished';

export interface PlotRecord {
  state: PlotStateName;
  finishedAt: number | null;
  emptySince: number | null;
}

export type Assignment = { index: number; retire: boolean } | 'allPlotsBusy';

/**
 * The Foreman assigns the lowest-index free plot; otherwise it retires the finished plot with the
 * oldest finishedAt, if it has been on display for at least `retireAfterMs`.
 */
export function assignPlot(plots: readonly PlotRecord[], now: number, retireAfterMs: number): Assignment {
  const free = plots.findIndex((p) => p.state === 'free');
  if (free >= 0) return { index: free, retire: false };
  let best = -1;
  for (let i = 0; i < plots.length; i++) {
    const p = plots[i] as PlotRecord;
    if (p.state !== 'finished' || p.finishedAt === null || now - p.finishedAt < retireAfterMs) continue;
    if (best < 0 || (p.finishedAt as number) < ((plots[best] as PlotRecord).finishedAt as number)) best = i;
  }
  return best >= 0 ? { index: best, retire: true } : 'allPlotsBusy';
}

/** A building whose crew has been empty for `afterMs` becomes unattended (adoptable). */
export function becomesUnattended(p: PlotRecord, now: number, afterMs: number): boolean {
  return p.state === 'building' && p.emptySince !== null && now - p.emptySince >= afterMs;
}
