import type { Inventory, Visibility } from "./types.js";

/** category -> sorted 1-based photo numbers where that category is present. */
export type Presence = Record<string, number[]>;

export function categoriesOf(inv: Inventory): Set<string> {
  return new Set(inv.items.map((i) => i.category));
}

/**
 * Presence by majority across inventory runs: category c is present in photo p when a strict majority
 * of p's inventory runs list at least one item of category c.
 * @param runs runs[photoIndex][runIndex]
 */
export function presentByMajority(runs: Inventory[][]): Presence {
  const out: Presence = {};
  runs.forEach((photoRuns, idx) => {
    const counts = new Map<string, number>();
    for (const run of photoRuns) for (const c of categoriesOf(run)) counts.set(c, (counts.get(c) ?? 0) + 1);
    for (const [c, n] of counts) {
      if (n * 2 > photoRuns.length) (out[c] ??= []).push(idx + 1);
    }
  });
  return out;
}

/**
 * The run used as the photo's item list for matching: the first run whose category set equals the
 * majority set, else the run with the smallest symmetric difference to it.
 */
export function representativeRun(photoRuns: Inventory[], majoritySet: Set<string>): Inventory {
  let best = photoRuns[0]!;
  let bestDiff = Infinity;
  for (const run of photoRuns) {
    const cats = categoriesOf(run);
    let diff = 0;
    for (const c of cats) if (!majoritySet.has(c)) diff++;
    for (const c of majoritySet) if (!cats.has(c)) diff++;
    if (diff < bestDiff) {
      best = run;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * inventory_agreement = 100 × mean over categories c present in ≥1 photo of
 *   |present(c) ∩ visible(c)| / |visible(c)|,   visible(c) = photos p with visibility[c][p] true.
 * A missing visibility cell counts as visible. If no photo is expected to show c (|visible(c)| = 0) the
 * ratio is 1. Appearances in photos where c is not expected neither help nor hurt: they cannot offset
 * absences in photos where it is expected.
 */
export function inventoryAgreement(present: Presence, visibility: Visibility, photos: number): number {
  const ratios: number[] = [];
  for (const [c, where] of Object.entries(present)) {
    if (where.length === 0) continue;
    const at = new Set(where);
    let visible = 0;
    let hit = 0;
    for (let p = 1; p <= photos; p++) {
      if (!(visibility[c]?.[String(p)] ?? true)) continue;
      visible++;
      if (at.has(p)) hit++;
    }
    ratios.push(visible === 0 ? 1 : hit / visible);
  }
  if (ratios.length === 0) return 0;
  return (100 * ratios.reduce((a, b) => a + b, 0)) / ratios.length;
}
