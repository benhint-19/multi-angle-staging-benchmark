import { describe, expect, it } from "vitest";
import { aggregateMatch, aggregateQuality, aggregateVisibility, majority, median } from "../src/aggregate.js";
import type { MatchResult } from "../src/types.js";

describe("median / majority", () => {
  it("median of 3 picks the middle value", () => {
    expect(median([4, 1, 3])).toBe(3);
    expect(median([0, 4, 4])).toBe(4);
  });
  it("median of an even count averages the middle two", () => {
    expect(median([2, 3])).toBe(2.5);
  });
  it("majority of booleans", () => {
    expect(majority([true, false, true])).toBe(true);
    expect(majority([false, false, true])).toBe(false);
  });
  it("median of empty throws", () => {
    expect(() => median([])).toThrow();
  });
});

describe("aggregateQuality", () => {
  it("takes median realism and majority architecture per photo", () => {
    const q = aggregateQuality([
      { realism: 2, architecture_preserved: true, notes: "a" },
      { realism: 4, architecture_preserved: false, notes: "b" },
      { realism: 3, architecture_preserved: true, notes: "c" },
    ]);
    expect(q).toEqual({ realism: 3, architecture_preserved: true, notes: "a" });
  });
});

describe("aggregateMatch", () => {
  const sofa = (identity: number, placement: number, order: "ab" | "ba" = "ab") => ({
    key: "sofa-x",
    category: "sofa" as const,
    appearances:
      order === "ab"
        ? [{ photo: 1, itemId: "i1" }, { photo: 2, itemId: "i3" }]
        : [{ photo: 2, itemId: "i3" }, { photo: 1, itemId: "i1" }],
    identity,
    placement,
  });

  it("groups the same appearance set across runs and takes medians", () => {
    const runs: MatchResult[] = [
      { shared: [sofa(4, 2)] },
      { shared: [sofa(3, 4, "ba")] },
      { shared: [sofa(4, 3)] },
    ];
    const agg = aggregateMatch(runs);
    expect(agg.shared).toHaveLength(1);
    expect(agg.shared[0]!.identity).toBe(4);
    expect(agg.shared[0]!.placement).toBe(3);
    expect(agg.fallback).toBe(false);
  });

  it("drops a shared item that only a minority of runs report", () => {
    const rug = {
      key: "rug",
      category: "rug" as const,
      appearances: [{ photo: 1, itemId: "i2" }, { photo: 3, itemId: "i1" }],
      identity: 1,
      placement: 1,
    };
    const runs: MatchResult[] = [
      { shared: [sofa(4, 4), rug] },
      { shared: [sofa(4, 4)] },
      { shared: [sofa(4, 4)] },
    ];
    const agg = aggregateMatch(runs);
    expect(agg.shared.map((s) => s.category)).toEqual(["sofa"]);
  });

  const item = (photos: number[], identity: number, placement: number) => ({
    key: `sofa-${photos.join("")}`,
    category: "sofa" as const,
    appearances: photos.map((photo) => ({ photo, itemId: "i1" })),
    identity,
    placement,
  });

  it("keeps an item whose runs split its appearances ({1,2,3} / {1,2} / {1,3})", () => {
    const runs: MatchResult[] = [
      { shared: [item([1, 2, 3], 4, 4)] },
      { shared: [item([1, 2], 3, 2)] },
      { shared: [item([1, 3], 2, 4)] },
    ];
    const agg = aggregateMatch(runs);
    expect(agg.fallback).toBe(false);
    expect(agg.shared).toHaveLength(1);
    expect(agg.shared[0]!.appearances.map((a) => a.photo)).toEqual([1, 2, 3]);
    expect(agg.shared[0]!.identity).toBe(3); // median(4, 3, 2)
    expect(agg.shared[0]!.placement).toBe(4); // median(4, 2, 4)
  });

  it("falls back to the median-consistency run when no link reaches a majority", () => {
    const runs: MatchResult[] = [
      { shared: [item([1, 2], 4, 4)] },
      { shared: [item([2, 3], 2, 2)] },
      { shared: [item([1, 3], 0, 0)] },
    ];
    const agg = aggregateMatch(runs);
    expect(agg.fallback).toBe(true);
    expect(agg.shared.map((s) => s.key)).toEqual(["sofa-23"]);
  });

  it("never joins two entries of the same photo into one item", () => {
    const mk = (key: string, ...nodes: [number, string][]) => ({
      key,
      category: "sofa" as const,
      identity: 4,
      placement: 4,
      appearances: nodes.map(([photo, itemId]) => ({ photo, itemId })),
    });
    // Majority links: 1:i1-2:i1, 1:i2-3:i1, 2:i1-3:i1. The last would put 1:i1 and 1:i2 together.
    const runs: MatchResult[] = [
      { shared: [mk("a", [1, "i1"], [2, "i1"]), mk("b", [1, "i2"], [3, "i1"])] },
      { shared: [mk("c", [1, "i1"], [2, "i1"], [3, "i1"])] },
      { shared: [mk("d", [1, "i2"], [2, "i1"], [3, "i1"])] },
    ];
    const agg = aggregateMatch(runs);
    expect(agg.shared.map((s) => s.appearances.map((x) => `${x.photo}:${x.itemId}`))).toEqual([
      ["1:i1", "2:i1"],
      ["1:i2", "3:i1"],
    ]);
  });
});

describe("aggregateVisibility", () => {
  it("takes the per-cell majority over runs, missing cells count as visible, only asked categories", () => {
    const v = aggregateVisibility(
      [{ sofa: { "1": true, "2": true } }, { sofa: { "1": true, "2": false } }, { sofa: { "2": false }, rug: { "1": false } }],
      ["sofa"],
      3,
    );
    expect(v).toEqual({ sofa: { "1": true, "2": false, "3": true } });
  });
});
