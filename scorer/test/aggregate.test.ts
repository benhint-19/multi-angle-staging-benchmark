import { describe, expect, it } from "vitest";
import { aggregateMatch, aggregateQuality, majority, median } from "../src/aggregate.js";
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
      { shared: [sofa(4, 2)], visibility: { sofa: { "1": true, "2": true } } },
      { shared: [sofa(3, 4, "ba")], visibility: { sofa: { "1": true, "2": false } } },
      { shared: [sofa(4, 3)], visibility: { sofa: { "1": true, "2": true } } },
    ];
    const agg = aggregateMatch(runs);
    expect(agg.shared).toHaveLength(1);
    expect(agg.shared[0]!.identity).toBe(4);
    expect(agg.shared[0]!.placement).toBe(3);
    expect(agg.visibility.sofa).toEqual({ "1": true, "2": true });
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
      { shared: [sofa(4, 4), rug], visibility: {} },
      { shared: [sofa(4, 4)], visibility: {} },
      { shared: [sofa(4, 4)], visibility: {} },
    ];
    const agg = aggregateMatch(runs);
    expect(agg.shared.map((s) => s.category)).toEqual(["sofa"]);
  });
});
