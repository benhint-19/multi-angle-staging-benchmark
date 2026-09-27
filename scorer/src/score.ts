import sharp from "sharp";
import { aggregateMatch, aggregateQuality, aggregateVisibility } from "./aggregate.js";
import type { Embedder } from "./embed.js";
import { identityAgreement, itemEmbeddingSimilarity } from "./identity.js";
import { inventoryAgreement, presentByMajority, representativeRun } from "./inventory.js";
import { sanitizeMatch, sanitizeVisibility, type Judge } from "./judge.js";
import { placementAgreement } from "./placement.js";
import { PROMPT_VERSION, PROTOCOL_VERSION } from "./prompts.js";
import type { BBox, Inventory, MasbResult, MatchResult, QualityResult, SharedItem, Visibility } from "./types.js";

export interface ScoreOptions {
  system: string;
  room: string;
  /** Original photos, in shooting order (photo 1 first). */
  originals: Buffer[];
  /** A system's staged outputs, same order as `originals`; null where the system delivered nothing. */
  staged: (Buffer | null)[];
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

/** Staged buffers with absent slots filled by the original (never cropped: absent photos have no items). */
const stagedFull = (staged: (Buffer | null)[], originals: Buffer[]) => staged.map((b, i) => b ?? originals[i]!);

export async function scoreRoom(opts: ScoreOptions): Promise<MasbResult> {
  const { judge, originals, staged } = opts;
  const runs = opts.runs ?? 3;
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`runs must be an integer >= 1, got ${runs}`);
  const log = opts.log ?? (() => {});
  const n = staged.length;
  if (n < 2) throw new Error(`need at least 2 photos, got ${n}`);
  if (originals.length !== n) throw new Error(`originals (${originals.length}) and staged (${n}) counts differ`);
  // Absent angles (PROTOCOL.md): inventory is empty (nothing present), quality skips it, and the match
  // call shows the original in its staged slot (it has no items, so nothing can link to it).
  // Visibility never sees staged photos: it is judged from the N originals alone.
  const absent = staged.flatMap((b, i) => (b ? [] : [i + 1]));
  const delivered = n - absent.length;
  if (delivered === 0) throw new Error("no staged photos delivered");
  if (absent.length) log(`absent: photo ${absent.join(", ")} (counted as missing items)`);

  const maxEdge = opts.judgeMaxEdge ?? 1024;
  const origJ = await Promise.all(originals.map((b) => forJudge(b, maxEdge)));
  const stagedJ = await Promise.all(staged.map((b, i) => (b ? forJudge(b, maxEdge) : origJ[i]!)));
  const times = <T>(f: () => Promise<T>) => Promise.all(Array.from({ length: runs }, f));

  log(`inventory: ${delivered} photos x ${runs} runs`);
  const invRuns: Inventory[][] = await Promise.all(
    stagedJ.map((s, i) => (staged[i] ? times(() => judge.inventory(s)) : Promise.resolve(Array.from({ length: runs }, () => ({ items: [] }))))),
  );
  const present = presentByMajority(invRuns);
  const inventories = invRuns.map((photoRuns, i) =>
    representativeRun(photoRuns, new Set(Object.entries(present).filter(([, ps]) => ps.includes(i + 1)).map(([c]) => c))),
  );

  const categories = Object.keys(present).sort();
  log(`match: ${runs} runs; visibility (originals only): ${runs} runs over ${categories.length} categories`);
  const [matchRuns, visSanitized] = await Promise.all([
    times(async (): Promise<MatchResult> => sanitizeMatch(await judge.match(origJ, stagedJ, inventories), inventories)),
    categories.length
      ? times(async () => sanitizeVisibility(await judge.visibility(origJ, categories), categories, n))
      : Promise.resolve([]),
  ]);
  const visibilityRuns: Visibility[] = visSanitized.map((x) => x.visibility);
  const unknownKeys = [...new Set(visSanitized.flatMap((x) => x.unknownKeys))];
  if (unknownKeys.length) log(`visibility: dropped unknown keys ${unknownKeys.join(", ")}`);
  const visibility = aggregateVisibility(visibilityRuns, categories, n);
  const match = aggregateMatch(matchRuns);
  if (match.fallback) log("match: no link reached a majority; using the median-consistency run");

  log(`quality: ${delivered} photos x ${runs} runs`);
  const qualityRuns: QualityResult[][] = await Promise.all(
    stagedJ.map((s, i) => (staged[i] ? times(() => judge.quality(origJ[i]!, s)) : Promise.resolve([]))),
  );
  const quality = qualityRuns.map((r, i) => (staged[i] ? aggregateQuality(r) : null));
  const deliveredQuality = quality.filter((q): q is QualityResult => q !== null);

  let embedding: { key: string; similarity: number | null }[] = match.shared.map((s) => ({ key: s.key, similarity: null }));
  let embeddingNote: string | undefined;
  if (!opts.embedder) {
    embeddingNote = "no embedder configured (REPLICATE_API_TOKEN unset or --no-embed)";
  } else if (match.shared.length > 0) {
    log(`embeddings: ${match.shared.length} shared items`);
    try {
      embedding = await embeddingSimilarity(match.shared, inventories, stagedFull(staged, originals), opts.embedder);
    } catch (err) {
      embeddingNote = `embedding failed: ${String(err)}`;
    }
  }
  const sims = embedding.flatMap((e) => (e.similarity === null ? [] : [e.similarity]));

  const inv = inventoryAgreement(present, visibility, n);
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
      realism: round((100 * deliveredQuality.reduce((a, q) => a + q.realism, 0)) / delivered / 4),
      architecture_preserved_rate: round(deliveredQuality.filter((q) => q.architecture_preserved).length / delivered, 3),
      identity_embedding_similarity: sims.length ? round(sims.reduce((a, b) => a + b, 0) / sims.length, 3) : null,
    },
    details: {
      inventories,
      present,
      shared: match.shared,
      visibility,
      quality,
      embedding,
      runs: { inventory: invRuns, match: matchRuns, visibility: visibilityRuns, quality: qualityRuns },
      flags: {
        no_shared_items: match.shared.length === 0,
        shared_fallback_median_run: match.fallback,
        visibility_unknown_keys: unknownKeys,
        ...(embeddingNote ? { embedding_note: embeddingNote } : {}),
        delivered,
        absent,
      },
    },
    judge: { model: judge.model, prompt_version: PROMPT_VERSION, protocol_version: PROTOCOL_VERSION, runs, aggregated: "median/majority" },
    embedder: opts.embedder && sims.length ? { model: opts.embedder.model, version: opts.embedder.version } : null,
    cost_usd: round(cost, 4),
    scored_at: (opts.now ?? (() => new Date()))().toISOString(),
  };
}
