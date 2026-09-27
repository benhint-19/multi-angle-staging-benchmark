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

/**
 * Per-(category, photo) strict majority over visibility runs, for every category in `categories` and
 * photo 1..`photos`; a run that omits a cell counts as "visible".
 */
export function aggregateVisibility(runs: Visibility[], categories: string[], photos: number): Visibility {
  const out: Visibility = {};
  for (const c of [...categories].sort()) {
    out[c] = {};
    for (let p = 1; p <= photos; p++) out[c]![String(p)] = majority(runs.map((r) => r[c]?.[String(p)] ?? true));
  }
  return out;
}

export interface AggregatedMatch extends MatchResult {
  /** True when no link reached a majority and the median-consistency run's shared set was used. */
  fallback: boolean;
}

const node = (photo: number, itemId: string) => `${photo}:${itemId}`;

/** Mean of identity and placement (0–4) over a run's shared items; 0 for an empty run. */
function runConsistency(run: MatchResult): number {
  if (run.shared.length === 0) return 0;
  return run.shared.reduce((a, s) => a + s.identity + s.placement, 0) / run.shared.length / 2;
}

/**
 * Aggregate several match runs. Item ids are pinned before matching, so every shared item in a run
 * is a set of pairwise links between inventory entries (`photo:itemId`). A link is kept when a strict
 * majority of runs make it. Kept links are joined into items (connected components, strongest links
 * first, never joining two entries from the same photo). Each item's identity/placement is the median
 * over every run item that contributed one of its kept links; its category is the most common among
 * them. If no link reaches a majority but some run found shared items, the shared set of the run with
 * the median mean(identity, placement) is used instead (`fallback: true`).
 */
export function aggregateMatch(runs: MatchResult[]): AggregatedMatch {
  type Contribution = { run: number; idx: number; item: SharedItem };
  const edges = new Map<string, { a: string; b: string; runs: Set<number>; contribs: Contribution[] }>();
  runs.forEach((run, r) => {
    run.shared.forEach((item, idx) => {
      const nodes = item.appearances.map((ap) => node(ap.photo, ap.itemId));
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
          const [a, b] = [nodes[i]!, nodes[j]!].sort() as [string, string];
          const k = `${a}|${b}`;
          const e = edges.get(k) ?? { a, b, runs: new Set<number>(), contribs: [] };
          e.runs.add(r);
          e.contribs.push({ run: r, idx, item });
          edges.set(k, e);
        }
    });
  });
  const kept = [...edges.entries()]
    .filter(([, e]) => e.runs.size * 2 > runs.length)
    .sort(([ka, a], [kb, b]) => b.runs.size - a.runs.size || ka.localeCompare(kb));

  // Union-find over inventory entries; a component never holds two entries of the same photo.
  const parent = new Map<string, string>();
  const photosOf = new Map<string, Set<number>>();
  const find = (x: string): string => {
    if (!parent.has(x)) {
      parent.set(x, x);
      photosOf.set(x, new Set([Number(x.split(":")[0])]));
    }
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const accepted: (typeof kept)[number][1][] = [];
  for (const [, e] of kept) {
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) {
      const pa = photosOf.get(ra)!;
      const pb = photosOf.get(rb)!;
      if ([...pa].some((p) => pb.has(p))) continue;
      parent.set(rb, ra);
      for (const p of pb) pa.add(p);
    }
    accepted.push(e);
  }

  const comps = new Map<string, { nodes: Set<string>; contribs: Map<string, Contribution> }>();
  for (const e of accepted) {
    const root = find(e.a);
    const c = comps.get(root) ?? { nodes: new Set<string>(), contribs: new Map<string, Contribution>() };
    c.nodes.add(e.a).add(e.b);
    for (const k of e.contribs) c.contribs.set(`${k.run}:${k.idx}`, k);
    comps.set(root, c);
  }
  let shared: SharedItem[] = [...comps.values()].map(({ nodes, contribs }) => {
    const items = [...contribs.values()].sort((x, y) => x.run - y.run || x.idx - y.idx).map((k) => k.item);
    const counts = new Map<SharedItem["category"], number>();
    for (const it of items) counts.set(it.category, (counts.get(it.category) ?? 0) + 1);
    const category = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]![0];
    return {
      key: items[0]!.key,
      category,
      appearances: [...nodes]
        .map((n) => {
          const i = n.indexOf(":");
          return { photo: Number(n.slice(0, i)), itemId: n.slice(i + 1) };
        })
        .sort((x, y) => x.photo - y.photo),
      identity: median(items.map((i) => i.identity)),
      placement: median(items.map((i) => i.placement)),
    };
  });
  shared.sort((x, y) => node(x.appearances[0]!.photo, x.appearances[0]!.itemId).localeCompare(node(y.appearances[0]!.photo, y.appearances[0]!.itemId)));

  let fallback = false;
  if (shared.length === 0 && runs.some((r) => r.shared.length > 0)) {
    const order = runs.map((r, i) => ({ i, c: runConsistency(r) })).sort((x, y) => x.c - y.c || x.i - y.i);
    const pick = runs[order[Math.floor((order.length - 1) / 2)]!.i]!;
    shared = pick.shared.map((s) => ({ ...s, appearances: [...s.appearances].sort((a, b) => a.photo - b.photo) }));
    fallback = true;
  }

  return { shared, fallback };
}
