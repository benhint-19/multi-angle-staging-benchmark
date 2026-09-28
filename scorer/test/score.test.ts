import { describe, expect, it } from "vitest";
import { scoreRoom } from "../src/score.js";
import { MasbResultSchema } from "../src/schema.js";
import { PROMPT_VERSION, PROTOCOL_VERSION } from "../src/prompts.js";
import type { Inventory, MatchResult } from "../src/types.js";
import { FakeEmbedder, FakeJudge, tinyJpeg } from "./fakes.js";

const items: Inventory = {
  items: [
    { id: "i1", category: "sofa", description: "grey sofa", bbox: [0.1, 0.4, 0.6, 0.9] },
    { id: "i2", category: "rug", description: "wool rug", bbox: [0.2, 0.7, 0.8, 1] },
  ],
};
const sofaOnly: Inventory = { items: [items.items[0]!] };

describe("scoreRoom with a fake judge", () => {
  it("aggregates runs, excludes the occluded rug, and computes all scores", async () => {
    const photos = await Promise.all(["#888", "#999", "#aaa"].map(tinyJpeg));
    // inventory calls run photo-by-photo (3 runs each): photo 3 never shows the rug.
    const inv = (call: number) => (Math.floor(call / 3) === 2 ? sofaOnly : items);
    const match = (id: number, pl: number): MatchResult => ({
      shared: [
        {
          key: "sofa",
          category: "sofa",
          appearances: [1, 2, 3].map((photo) => ({ photo, itemId: "i1" })),
          identity: id,
          placement: pl,
        },
        {
          key: "rug",
          category: "rug",
          appearances: [1, 2].map((photo) => ({ photo, itemId: "i2" })),
          identity: 4,
          placement: 4,
        },
      ],
    });
    const vis = (rugVisibleIn3: boolean) => ({ sofa: { "1": true, "2": true, "3": true }, rug: { "1": true, "2": true, "3": rugVisibleIn3 } });
    const judge = new FakeJudge(
      inv,
      [match(4, 2), match(2, 4), match(4, 4)],
      [
        { realism: 3, architecture_preserved: true, notes: "" },
        { realism: 4, architecture_preserved: true, notes: "" },
        { realism: 2, architecture_preserved: false, notes: "" },
      ],
      [vis(false), vis(true), vis(false)],
    );
    const r = await scoreRoom({
      system: "test",
      room: "room",
      originals: photos,
      staged: photos,
      judge,
      embedder: new FakeEmbedder(),
      runs: 3,
      now: () => new Date("2026-09-27T00:00:00Z"),
    });
    expect(judge.calls).toEqual({ inventory: 9, match: 3, visibility: 3, quality: 9 });
    expect(judge.visibilityInputs).toEqual([3, 3, 3]);
    // rug: present in 1,2; visibility majority says not visible in 3 → 2/2; sofa 3/3.
    expect(r.scores.inventory_agreement).toBe(100);
    // sofa identity median(4,2,4)=4, placement median(2,4,4)=4; rug 4/4.
    expect(r.scores.identity_agreement).toBe(100);
    expect(r.scores.placement_agreement).toBe(100);
    expect(r.scores.consistency).toBe(100);
    // every photo's quality runs are (3,T),(4,T),(2,F) → median 3, majority true.
    expect(r.scores.realism).toBe(75);
    expect(r.scores.architecture_preserved_rate).toBe(1);
    expect(r.scores.identity_embedding_similarity).toBe(1);
    expect(r.details.runs.match).toHaveLength(3);
    expect(r.details.runs.visibility).toHaveLength(3);
    expect(r.details.flags.no_shared_items).toBe(false);
    expect(r.judge).toEqual({ model: "fake-judge", prompt_version: PROMPT_VERSION, protocol_version: PROTOCOL_VERSION, runs: 3, aggregated: "median/majority" });
    expect(r.embedder).toEqual({ model: "fake-embedder", version: "0" });
    expect(r.details.flags.shared_fallback_median_run).toBe(false);
    expect(r.details.flags.visibility_unknown_keys).toEqual([]);
    expect(() => MasbResultSchema.parse(r)).not.toThrow();
    expect(r.cost_usd).toBe(0.01);
    expect(r.photos).toBe(3);
  });

  it("flags no shared items and scores identity/placement 0", async () => {
    const photos = await Promise.all(["#111", "#222"].map(tinyJpeg));
    const judge = new FakeJudge(
      () => sofaOnly,
      [{ shared: [] }],
      [{ realism: 4, architecture_preserved: true, notes: "" }],
    );
    const r = await scoreRoom({ system: "s", room: "r", originals: photos, staged: photos, judge, embedder: null, runs: 3 });
    expect(r.details.flags.no_shared_items).toBe(true);
    expect(r.scores.identity_agreement).toBe(0);
    expect(r.scores.placement_agreement).toBe(0);
    expect(r.scores.inventory_agreement).toBe(100);
    expect(r.scores.consistency).toBeCloseTo(33.3, 1);
    expect(r.scores.identity_embedding_similarity).toBeNull();
    expect(r.embedder).toBeNull();
    expect(() => MasbResultSchema.parse(r)).not.toThrow();
  });

  it("absent angle: counts as missing items where visible, quality over delivered photos only", async () => {
    const photos = await Promise.all(["#888", "#999", "#aaa"].map(tinyJpeg));
    const judge = new FakeJudge(
      () => sofaOnly,
      [
        {
          shared: [{ key: "sofa", category: "sofa", appearances: [1, 2].map((photo) => ({ photo, itemId: "i1" })), identity: 4, placement: 4 }],
        },
      ],
      [
        { realism: 4, architecture_preserved: true, notes: "" },
        { realism: 2, architecture_preserved: false, notes: "" },
        { realism: 4, architecture_preserved: true, notes: "" },
      ],
      [{ sofa: { "1": true, "2": true, "3": true } }],
    );
    const r = await scoreRoom({
      system: "s",
      room: "r",
      originals: photos,
      staged: [photos[0]!, photos[1]!, null],
      judge,
      embedder: null,
      runs: 3,
    });
    // no inventory or quality calls for the absent photo; the match call still covers all 3 angles
    expect(judge.calls).toEqual({ inventory: 6, match: 3, visibility: 3, quality: 6 });
    expect(r.details.present).toEqual({ sofa: [1, 2] });
    // sofa visible from 1, 2, 3 but present in 1, 2 → 2/3
    expect(r.scores.inventory_agreement).toBe(66.7);
    expect(r.scores.identity_agreement).toBe(100);
    expect(r.scores.placement_agreement).toBe(100);
    expect(r.scores.consistency).toBe(88.9);
    // each delivered photo: realism median(4,2,4)=4, architecture majority true
    expect(r.scores.realism).toBe(100);
    expect(r.scores.architecture_preserved_rate).toBe(1);
    expect(r.details.quality[2]).toBeNull();
    expect(r.details.runs.quality[2]).toEqual([]);
    expect(r.details.flags.delivered).toBe(2);
    expect(r.details.flags.absent).toEqual([3]);
    expect(r.photos).toBe(3);
    expect(() => MasbResultSchema.parse(r)).not.toThrow();
  });

  it("absent angle: the penalty does not depend on the match judge", async () => {
    const photos = await Promise.all(["#888", "#999", "#aaa"].map(tinyJpeg));
    // The match judge finds nothing shared; visibility (originals only) says the sofa is in view from 1–3.
    const judge = new FakeJudge(
      () => sofaOnly,
      [{ shared: [] }],
      [{ realism: 3, architecture_preserved: true, notes: "" }],
      [{ sofa: { "1": true, "2": true, "3": true } }],
    );
    const r = await scoreRoom({ system: "s", room: "r", originals: photos, staged: [photos[0]!, photos[1]!, null], judge, embedder: null, runs: 3 });
    expect(r.scores.inventory_agreement).toBe(66.7);
    expect(r.details.visibility).toEqual({ sofa: { "1": true, "2": true, "3": true } });
  });

  it("delivered photo: a category the visibility judge says is out of view from photo 2 is excluded there", async () => {
    const photos = await Promise.all(["#888", "#999", "#aaa"].map(tinyJpeg));
    // rug present in staged photos 1 and 2 only; judged out of view from 2 and 3 → 1/1.
    const inv = (call: number) => (Math.floor(call / 3) === 0 || Math.floor(call / 3) === 1 ? items : sofaOnly);
    const judge = new FakeJudge(
      inv,
      [{ shared: [] }],
      [{ realism: 3, architecture_preserved: true, notes: "" }],
      [{ sofa: { "1": true, "2": true, "3": true }, rug: { "1": true, "2": false, "3": false } }],
    );
    const r = await scoreRoom({ system: "s", room: "r", originals: photos, staged: photos, judge, embedder: null, runs: 3 });
    expect(r.details.present).toEqual({ sofa: [1, 2, 3], rug: [1, 2] });
    expect(r.scores.inventory_agreement).toBe(100);
  });

  it("counts unrated match items over all runs; scores come from the rated items only (protocol 0.1.4)", async () => {
    const photos = await Promise.all(["#888", "#999"].map(tinyJpeg));
    const sofa = { key: "sofa", category: "sofa" as const, appearances: [1, 2].map((photo) => ({ photo, itemId: "i1" })), identity: 4, placement: 4 };
    const judge = new FakeJudge(
      () => sofaOnly,
      [{ shared: [sofa], unrated: 2 }, { shared: [sofa], unrated: 0 }, { shared: [sofa], unrated: 1 }],
      [{ realism: 3, architecture_preserved: true, notes: "" }],
      [{ sofa: { "1": true, "2": true } }],
    );
    const r = await scoreRoom({ system: "s", room: "r", originals: photos, staged: photos, judge, embedder: null, runs: 3 });
    expect(r.details.flags.unrated_items).toBe(3);
    expect(r.scores.identity_agreement).toBe(100);
    expect(r.details.runs.match.every((m) => !("unrated" in m))).toBe(true);
    expect(r.judge.protocol_version).toBe("0.1.4");
    expect(() => MasbResultSchema.parse(r)).not.toThrow();
  });

  it("result files written before protocol 0.1.4 (no unrated_items) still validate", async () => {
    const photos = await Promise.all(["#888", "#999"].map(tinyJpeg));
    const judge = new FakeJudge(() => sofaOnly, [{ shared: [] }], [{ realism: 3, architecture_preserved: true, notes: "" }]);
    const r = await scoreRoom({ system: "s", room: "r", originals: photos, staged: photos, judge, embedder: null, runs: 1 });
    expect(r.details.flags.unrated_items).toBe(0);
    const { unrated_items: _drop, ...flags } = r.details.flags;
    expect(() => MasbResultSchema.parse({ ...r, details: { ...r.details, flags } })).not.toThrow();
  });

  it("rejects a non-integer or zero run count", async () => {
    const p = await tinyJpeg("#000");
    const judge = new FakeJudge(() => sofaOnly, [{ shared: [] }], []);
    await expect(scoreRoom({ system: "s", room: "r", originals: [p, p], staged: [p, p], judge, runs: 0 })).rejects.toThrow(/runs/);
    await expect(scoreRoom({ system: "s", room: "r", originals: [p, p], staged: [p, p], judge, runs: 1.5 })).rejects.toThrow(/runs/);
  });

  it("rejects mismatched photo counts", async () => {
    const p = await tinyJpeg("#000");
    const judge = new FakeJudge(() => sofaOnly, [{ shared: [] }], []);
    await expect(scoreRoom({ system: "s", room: "r", originals: [p, p], staged: [p, p, p], judge })).rejects.toThrow();
  });
});
