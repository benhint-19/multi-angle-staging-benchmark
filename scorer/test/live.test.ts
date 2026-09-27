/**
 * Live sanity check (spends real money, ~$0.20): a synthetic room whose three "staged" photos are the
 * SAME furnished image must score ~100 consistency. Runs only when ANTHROPIC_API_KEY is set and
 * MASB_LIVE_STAGED points at a furnished (staged) photo. REPLICATE_API_TOKEN additionally exercises
 * the CLIP embedding path; MASB_LIVE_OUT=<file> saves the full result JSON. Originals are the amber-ridge-living set from the dataset.
 *
 *   MASB_LIVE_STAGED=/path/to/staged.jpg ANTHROPIC_API_KEY=... pnpm test test/live.test.ts
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ReplicateClipEmbedder } from "../src/embed.js";
import { listNumbered } from "../src/io.js";
import { AnthropicJudge } from "../src/judge.js";
import { scoreRoom } from "../src/score.js";
import { MasbResultSchema } from "../src/schema.js";

const ROOM = fileURLToPath(new URL("../../data/rooms/amber-ridge-living", import.meta.url));
const staged = process.env.MASB_LIVE_STAGED;
const live = Boolean(process.env.ANTHROPIC_API_KEY && staged);

describe.skipIf(!live)("live: identical staged photos", () => {
  it("scores consistency >= 95 for three copies of one staged image", { timeout: 900_000 }, async () => {
    const originals = await Promise.all((await listNumbered(ROOM)).map((f) => readFile(f.file)));
    const img = await readFile(staged!);
    const result = await scoreRoom({
      system: "identical-copies",
      room: "amber-ridge-living",
      originals,
      staged: originals.map(() => img),
      judge: new AnthropicJudge(),
      embedder: process.env.REPLICATE_API_TOKEN ? new ReplicateClipEmbedder() : null,
      runs: 3,
    });
    if (process.env.MASB_LIVE_OUT) await writeFile(process.env.MASB_LIVE_OUT, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ scores: result.scores, cost_usd: result.cost_usd, flags: result.details.flags }));
    expect(() => MasbResultSchema.parse(result)).not.toThrow();
    expect(result.details.flags.no_shared_items).toBe(false);
    expect(result.scores.consistency).toBeGreaterThanOrEqual(95);
    expect(result.cost_usd).toBeLessThan(0.5);
    if (result.scores.identity_embedding_similarity !== null) {
      expect(result.scores.identity_embedding_similarity).toBeGreaterThan(0.9);
    }
  });
});
