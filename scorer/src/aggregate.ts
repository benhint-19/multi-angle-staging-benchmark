import type { MatchResult, QualityResult, SharedItem, Visibility } from "./types.js";

export function median(values: number[]): number {
  if (values.length === 0) throw new Error("median of empty list");
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Strict majority of true; ties resolve to false. */
export function majority(values: boolean[]): boolean {
  const yes = values.filter(Boolean).length;
  return yes * 2 > values.length;
}

export function aggregateQuality(runs: QualityResult[]): QualityResult {
  return {
    realism: median(runs.map((r) => r.realism)),
    architecture_preserved: majority(runs.map((r) => r.architecture_preserved)),
    notes: runs[0]?.notes ?? "",
  };
}

/** Canonical identity of a shared item: its sorted set of photo:itemId appearances. */
export function appearanceKey(item: Pick<SharedItem, "appearances">): string {
  return item.appearances
    .map((a) => `${a.photo}:${a.itemId}`)
    .sort()
    .join("|");
}

/**
 * Aggregate several match runs. Item ids are fixed (the inventories are pinned before matching), so a
 * shared item is identified by its appearance set. An item is kept when a strict majority of runs
 * report it; its identity/placement are the medians over the runs that reported it. Visibility is the
 * per-(category, photo) majority over all runs (a run that omits a cell counts as "visible").
 */
export function aggregateMatch(runs: MatchResult[]): MatchResult {
  const groups = new Map<string, SharedItem[]>();
  for (const run of runs) {
    const seen = new Set<string>();
    for (const item of run.shared) {
      const k = appearanceKey(item);
      if (seen.has(k)) continue;
      seen.add(k);
      const g = groups.get(k) ?? [];
      g.push(item);
      groups.set(k, g);
    }
  }
  const shared: SharedItem[] = [];
  for (const [, items] of groups) {
    if (items.length * 2 <= runs.length) continue;
    const first = items[0]!;
    shared.push({
      key: first.key,
      category: first.category,
      appearances: [...first.appearances].sort((a, b) => a.photo - b.photo),
      identity: median(items.map((i) => i.identity)),
      placement: median(items.map((i) => i.placement)),
    });
  }

  const cats = new Set<string>();
  const photos = new Set<string>();
  for (const run of runs) {
    for (const [c, row] of Object.entries(run.visibility)) {
      cats.add(c);
      for (const p of Object.keys(row)) photos.add(p);
    }
  }
  const visibility: Visibility = {};
  for (const c of cats) {
    visibility[c] = {};
    for (const p of photos) {
      visibility[c]![p] = majority(runs.map((r) => r.visibility[c]?.[p] ?? true));
    }
  }
  return { shared, visibility };
}
