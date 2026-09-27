import sharp from "sharp";
import { aggregateMatch, aggregateQuality } from "./aggregate.js";
import type { Embedder } from "./embed.js";
import { identityAgreement, itemEmbeddingSimilarity } from "./identity.js";
import { inventoryAgreement, presentByMajority, representativeRun } from "./inventory.js";
import { sanitizeMatch, type Judge } from "./judge.js";
import { placementAgreement } from "./placement.js";
import { PROMPT_VERSION } from "./prompts.js";
import type { BBox, Inventory, MasbResult, MatchResult, QualityResult, SharedItem } from "./types.js";

export interface ScoreOptions {
  system: string;
  room: string;
  /** Original photos, in shooting order (photo 1 first). */
  originals: Buffer[];
  /** A system's staged outputs, same order as `originals`. */
  staged: Buffer[];
  judge: Judge;
  /** null/undefined → identity_embedding_similarity is reported as null. */
  embedder?: Embedder | null;
  runs?: number;
  /** Long edge (px) of the images sent to the judge. */
  judgeMaxEdge?: number;
  log?: (msg: string) => void;
  now?: () => Date;
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

async function forJudge(buf: Buffer, maxEdge: number): Promise<Buffer> {
  return sharp(buf).rotate().resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
}

/** Crop a normalised bbox out of an image; null when the box is degenerate. */
export async function cropBBox(buf: Buffer, bbox: BBox): Promise<Buffer | null> {
  const img = sharp(buf).rotate();
  const { width = 0, height = 0 } = await img.metadata();
  const [x0, y0, x1, y1] = bbox;
  const left = Math.floor(Math.min(x0, x1) * width);
  const top = Math.floor(Math.min(y0, y1) * height);
  const w = Math.min(width - left, Math.ceil(Math.abs(x1 - x0) * width));
  const h = Math.min(height - top, Math.ceil(Math.abs(y1 - y0) * height));
  if (w < 8 || h < 8) return null;
  return img.extract({ left, top, width: w, height: h }).jpeg({ quality: 90 }).toBuffer();
}

async function embeddingSimilarity(
  shared: SharedItem[],
  inventories: Inventory[],
  staged: Buffer[],
  embedder: Embedder,
): Promise<{ key: string; similarity: number | null }[]> {
  const crops: Buffer[] = [];
  const owners: number[][] = shared.map(() => []);
  for (const [si, item] of shared.entries()) {
    for (const a of item.appearances) {
      const found = inventories[a.photo - 1]?.items.find((i) => i.id === a.itemId);
      if (!found) continue;
      const crop = await cropBBox(staged[a.photo - 1]!, found.bbox);
      if (!crop) continue;
      owners[si]!.push(crops.length);
      crops.push(crop);
    }
  }
  const vectors = await embedder.embed(crops);
  return shared.map((item, si) => ({
    key: item.key,
    similarity: itemEmbeddingSimilarity(owners[si]!.map((ci) => vectors[ci]!)),
  }));
}

export async function scoreRoom(opts: ScoreOptions): Promise<MasbResult> {
  const { judge, originals, staged } = opts;
  const runs = opts.runs ?? 3;
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`runs must be an integer >= 1, got ${runs}`);
  const log = opts.log ?? (() => {});
  const n = staged.length;
  if (n < 2) throw new Error(`need at least 2 photos, got ${n}`);
  if (originals.length !== n) throw new Error(`originals (${originals.length}) and staged (${n}) counts differ`);

  const maxEdge = opts.judgeMaxEdge ?? 1024;
  const origJ = await Promise.all(originals.map((b) => forJudge(b, maxEdge)));
  const stagedJ = await Promise.all(staged.map((b) => forJudge(b, maxEdge)));
  const times = <T>(f: () => Promise<T>) => Promise.all(Array.from({ length: runs }, f));

  log(`inventory: ${n} photos x ${runs} runs`);
  const invRuns: Inventory[][] = await Promise.all(stagedJ.map((s) => times(() => judge.inventory(s))));
  const present = presentByMajority(invRuns);
  const inventories = invRuns.map((photoRuns, i) =>
    representativeRun(photoRuns, new Set(Object.entries(present).filter(([, ps]) => ps.includes(i + 1)).map(([c]) => c))),
  );

  log(`match: ${runs} runs`);
  const sanitized = await times(async () => sanitizeMatch(await judge.match(origJ, stagedJ, inventories), inventories));
  const matchRuns: MatchResult[] = sanitized.map((x) => x.match);
  const unknownKeys = [...new Set(sanitized.flatMap((x) => x.unknownKeys))];
  if (unknownKeys.length) log(`visibility: dropped unknown keys ${unknownKeys.join(", ")}`);
  const match = aggregateMatch(matchRuns, n);
  if (match.fallback) log("match: no link reached a majority; using the median-consistency run");

  log(`quality: ${n} photos x ${runs} runs`);
  const qualityRuns: QualityResult[][] = await Promise.all(
    stagedJ.map((s, i) => times(() => judge.quality(origJ[i]!, s))),
  );
  const quality = qualityRuns.map(aggregateQuality);

  let embedding: { key: string; similarity: number | null }[] = match.shared.map((s) => ({ key: s.key, similarity: null }));
  let embeddingNote: string | undefined;
  if (!opts.embedder) {
    embeddingNote = "no embedder configured (REPLICATE_API_TOKEN unset or --no-embed)";
  } else if (match.shared.length > 0) {
    log(`embeddings: ${match.shared.length} shared items`);
    try {
      embedding = await embeddingSimilarity(match.shared, inventories, staged, opts.embedder);
    } catch (err) {
      embeddingNote = `embedding failed: ${String(err)}`;
    }
  }
  const sims = embedding.flatMap((e) => (e.similarity === null ? [] : [e.similarity]));

  const inv = inventoryAgreement(present, match.visibility, n);
  const id = identityAgreement(match.shared);
  const pl = placementAgreement(match.shared);
  const cost = judge.costUsd() + (opts.embedder?.costUsd() ?? 0);

  return {
    benchmark: "MASB",
    version: "0.1.0",
    system: opts.system,
    room: opts.room,
    photos: n,
    scores: {
      consistency: round((inv + id + pl) / 3),
      inventory_agreement: round(inv),
      identity_agreement: round(id),
      placement_agreement: round(pl),
      realism: round((100 * quality.reduce((a, q) => a + q.realism, 0)) / n / 4),
      architecture_preserved_rate: round(quality.filter((q) => q.architecture_preserved).length / n, 3),
      identity_embedding_similarity: sims.length ? round(sims.reduce((a, b) => a + b, 0) / sims.length, 3) : null,
    },
    details: {
      inventories,
      present,
      shared: match.shared,
      visibility: match.visibility,
      quality,
      embedding,
      runs: { inventory: invRuns, match: matchRuns, quality: qualityRuns },
      flags: {
        no_shared_items: match.shared.length === 0,
        shared_fallback_median_run: match.fallback,
        visibility_unknown_keys: unknownKeys,
        ...(embeddingNote ? { embedding_note: embeddingNote } : {}),
      },
    },
    judge: { model: judge.model, prompt_version: PROMPT_VERSION, runs, aggregated: "median/majority" },
    embedder: opts.embedder && sims.length ? { model: opts.embedder.model, version: opts.embedder.version } : null,
    cost_usd: round(cost, 4),
    scored_at: (opts.now ?? (() => new Date()))().toISOString(),
  };
}
