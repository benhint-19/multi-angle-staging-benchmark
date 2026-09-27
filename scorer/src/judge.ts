import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { INVENTORY_PROMPT, QUALITY_PROMPT, SYSTEM_PROMPT, renderMatchPrompt } from "./prompts.js";
import { CATEGORIES, type Category, type Inventory, type MatchResult, type QualityResult } from "./types.js";

/** One judge run per call; the scorer repeats calls and aggregates. Inject a fake in tests. */
export interface Judge {
  readonly model: string;
  /** Items in one staged photo. */
  inventory(staged: Buffer): Promise<Inventory>;
  /** Cross-photo matching + visibility (raw; the scorer sanitises it). `inventories[i]` is photo i+1's. */
  match(originals: Buffer[], staged: Buffer[], inventories: Inventory[]): Promise<MatchResult>;
  /** Per-photo realism + architecture check. */
  quality(original: Buffer, staged: Buffer): Promise<QualityResult>;
  costUsd(): number;
}

// ---------- schemas ----------

const categorySchema = z.preprocess((v) => {
  const s = normalizeCategory(String(v));
  return (CATEGORIES as readonly string[]).includes(s) ? s : "other";
}, z.enum(CATEGORIES));

const unit = z.number().transform((n) => Math.min(1, Math.max(0, n)));
const rating = z.number().min(0).max(4);

export const inventorySchema = z.object({
  items: z.array(
    z.object({
      id: z.string().min(1),
      category: categorySchema,
      description: z.string(),
      bbox: z.tuple([unit, unit, unit, unit]),
    }),
  ),
});

export const matchSchema = z.object({
  shared: z.array(
    z.object({
      key: z.string(),
      category: categorySchema,
      appearances: z.array(z.object({ photo: z.number().int(), itemId: z.string() })),
      identity: rating,
      placement: rating,
    }),
  ),
  visibility: z.record(z.string(), z.record(z.string(), z.boolean())),
});

export const qualitySchema = z.object({
  realism: rating,
  architecture_preserved: z.boolean(),
  notes: z.string(),
});

/** Pull the JSON object out of a model reply (tolerates code fences or stray prose). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in reply");
  return JSON.parse(text.slice(start, end + 1));
}

export function normalizeCategory(v: string): string {
  return v.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** "1", "01", "photo 1", "Photo_1" → 1; anything else → null. */
export function normalizePhotoKey(v: string): number | null {
  const m = /^\s*(?:photo[\s_-]*)?0*(\d+)\s*$/i.exec(v);
  return m ? Number(m[1]) : null;
}

export interface SanitizedMatch {
  match: MatchResult;
  /** Visibility keys that did not normalise to a known category / photo number (dropped). */
  unknownKeys: string[];
}

/**
 * Clean one raw match reply against the pinned inventories:
 * - shared: drop appearances that reference unknown photos/items, keep one appearance per photo, let each
 *   inventory entry belong to one shared item, drop items left with fewer than two photos;
 * - visibility: normalise category keys (case, spaces, hyphens) and photo keys ("01", "photo 1" → "1");
 *   drop and report keys that are not a category in the inventories or not a photo 1..N.
 */
export function sanitizeMatch(m: MatchResult, inventories: Inventory[]): SanitizedMatch {
  const used = new Set<string>();
  const shared = [];
  for (const s of m.shared) {
    const photos = new Set<number>();
    const appearances = [];
    for (const a of s.appearances) {
      const inv = inventories[a.photo - 1];
      const k = `${a.photo}:${a.itemId}`;
      if (!inv || !inv.items.some((i) => i.id === a.itemId) || photos.has(a.photo) || used.has(k)) continue;
      photos.add(a.photo);
      appearances.push(a);
    }
    if (appearances.length < 2) continue;
    for (const a of appearances) used.add(`${a.photo}:${a.itemId}`);
    shared.push({ ...s, appearances });
  }

  const known = new Set(inventories.flatMap((inv) => inv.items.map((i) => i.category as string)));
  const unknownKeys: string[] = [];
  const visibility: MatchResult["visibility"] = {};
  for (const [rawCat, row] of Object.entries(m.visibility)) {
    const cat = normalizeCategory(rawCat);
    if (!known.has(cat)) {
      unknownKeys.push(`category:${rawCat}`);
      continue;
    }
    const out = (visibility[cat] ??= {});
    for (const [rawPhoto, v] of Object.entries(row)) {
      const p = normalizePhotoKey(rawPhoto);
      if (p === null || p < 1 || p > inventories.length) {
        unknownKeys.push(`photo:${rawCat}/${rawPhoto}`);
        continue;
      }
      if (!(String(p) in out)) out[String(p)] = v;
    }
  }
  return { match: { shared, visibility }, unknownKeys };
}

// ---------- Anthropic implementation ----------

/** USD per million tokens (claude-sonnet-5 list price). */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2, output: 10 },
};

export interface AnthropicJudgeOptions {
  model?: string;
  effort?: "low" | "medium" | "high";
  /** Schema retries after the first attempt. */
  retries?: number;
  apiKey?: string;
}

type Block = Anthropic.ContentBlockParam;

const img = (buf: Buffer): Block => ({
  type: "image",
  source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") },
});
const txt = (text: string): Block => ({ type: "text", text });

export class AnthropicJudge implements Judge {
  readonly model: string;
  private readonly client: Anthropic;
  private readonly effort: "low" | "medium" | "high";
  private readonly retries: number;
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(opts: AnthropicJudgeOptions = {}) {
    this.model = opts.model ?? "claude-sonnet-5";
    this.effort = opts.effort ?? "medium";
    this.retries = opts.retries ?? 3;
    this.client = new Anthropic({ apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY });
  }

  costUsd(): number {
    const p = PRICES[this.model] ?? { input: 2, output: 10 };
    return (this.inputTokens * p.input + this.outputTokens * p.output) / 1e6;
  }

  private async call<T>(content: Block[], schema: z.ZodType<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      // Sampling parameters (temperature) are not accepted by this model; determinism comes from the
      // fixed prompts plus median-of-runs aggregation.
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        output_config: { effort: this.effort },
        messages: [{ role: "user", content }],
      });
      this.inputTokens +=
        res.usage.input_tokens + (res.usage.cache_creation_input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0);
      this.outputTokens += res.usage.output_tokens;
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      try {
        return schema.parse(extractJson(text));
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(`judge reply failed schema validation after ${this.retries + 1} attempts: ${String(lastErr)}`);
  }

  inventory(staged: Buffer): Promise<Inventory> {
    return this.call([img(staged), txt(INVENTORY_PROMPT)], inventorySchema) as Promise<Inventory>;
  }

  async match(originals: Buffer[], staged: Buffer[], inventories: Inventory[]): Promise<MatchResult> {
    const content: Block[] = [];
    originals.forEach((o, i) => {
      content.push(txt(`Original ${i + 1}`), img(o), txt(`Staged ${i + 1}`), img(staged[i]!));
    });
    const invJson = JSON.stringify(
      Object.fromEntries(
        inventories.map((inv, i) => [
          `photo ${i + 1}`,
          inv.items.map(({ id, category, description }) => ({ id, category, description })),
        ]),
      ),
    );
    const cats = [...new Set(inventories.flatMap((inv) => inv.items.map((i) => i.category as Category)))].sort();
    content.push(txt(renderMatchPrompt(originals.length, invJson, cats)));
    return (await this.call(content, matchSchema)) as MatchResult;
  }

  quality(original: Buffer, staged: Buffer): Promise<QualityResult> {
    return this.call([txt("Image 1"), img(original), txt("Image 2"), img(staged), txt(QUALITY_PROMPT)], qualitySchema);
  }
}
