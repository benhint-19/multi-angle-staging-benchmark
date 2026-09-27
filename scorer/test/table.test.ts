import { describe, expect, it } from "vitest";
import { renderTable } from "../src/table.js";
import type { MasbResult } from "../src/types.js";

const result = (system: string, room: string, consistency: number, noShared = false): MasbResult => ({
  benchmark: "MASB",
  version: "0.1.0",
  system,
  room,
  photos: 3,
  scores: {
    consistency,
    inventory_agreement: consistency,
    identity_agreement: consistency,
    placement_agreement: consistency,
    realism: 75,
    architecture_preserved_rate: 2 / 3,
    identity_embedding_similarity: noShared ? null : 0.912,
  },
  details: {
    inventories: [],
    present: {},
    shared: [],
    visibility: {},
    quality: [],
    embedding: [],
    runs: { inventory: [], match: [], quality: [] },
    flags: { no_shared_items: noShared, shared_fallback_median_run: false, visibility_unknown_keys: [] },
  },
  judge: { model: "claude-sonnet-5", prompt_version: "0.1.1", runs: 3, aggregated: "median/majority" },
  embedder: null,
  cost_usd: 0.3,
  scored_at: "2026-09-27T00:00:00Z",
});

describe("renderTable", () => {
  const md = renderTable([
    result("single-photo", "amber-ridge-living", 40, true),
    result("multi-angle", "amber-ridge-living", 90),
    result("multi-angle", "amber-ridge-bedroom", 80),
  ]);

  it("ranks systems by mean consistency", () => {
    expect(md).toContain("| multi-angle | 2 | 85.0 | 85.0 | 85.0 | 85.0 | 75.0 | 67% |");
    expect(md.indexOf("| multi-angle | 2")).toBeLessThan(md.indexOf("| single-photo | 1"));
  });

  it("lists every room row, flags missing shared items, prints n/a CLIP", () => {
    expect(md).toContain("| amber-ridge-living | 3 | single-photo | 40.0 (no shared items) | 40.0 | 40.0 | 40.0 | 75.0 | 67% | n/a |");
    expect(md).toContain("| amber-ridge-bedroom | 3 | multi-angle | 80.0 | 80.0 | 80.0 | 80.0 | 75.0 | 67% | 0.912 |");
    expect(md).toContain("Judge: claude-sonnet-5 (median of 3).");
  });
});

describe("renderTable absent angles", () => {
  it("shows delivered of N and a footnote", () => {
    const r = result("sys", "room", 70);
    r.photos = 4;
    r.details.flags.absent = [4];
    r.details.flags.delivered = 3;
    const md = renderTable([r]);
    expect(md).toContain("| room | 3 of 4 | sys |");
    expect(md).toContain("Absent angles");
  });
});
