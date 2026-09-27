/** Runtime schema for MASB result files (the site / downstream tools can validate JSON with it). */
import { z } from "zod";
import { CATEGORIES, type MasbResult } from "./types.js";

const bbox = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const inventory = z.object({
  items: z.array(z.object({ id: z.string(), category: z.enum(CATEGORIES), description: z.string(), bbox })),
});
const shared = z.object({
  key: z.string(),
  category: z.enum(CATEGORIES),
  appearances: z.array(z.object({ photo: z.number().int(), itemId: z.string() })),
  identity: z.number().min(0).max(4),
  placement: z.number().min(0).max(4),
});
const visibility = z.record(z.string(), z.record(z.string(), z.boolean()));
const match = z.object({ shared: z.array(shared), visibility });
const quality = z.object({ realism: z.number().min(0).max(4), architecture_preserved: z.boolean(), notes: z.string() });
const pct = z.number().min(0).max(100);

export const MasbResultSchema = z.object({
  benchmark: z.literal("MASB"),
  version: z.literal("0.1.0"),
  system: z.string(),
  room: z.string(),
  photos: z.number().int().min(2),
  scores: z.object({
    consistency: pct,
    inventory_agreement: pct,
    identity_agreement: pct,
    placement_agreement: pct,
    realism: pct,
    architecture_preserved_rate: z.number().min(0).max(1),
    identity_embedding_similarity: z.number().min(-1).max(1).nullable(),
  }),
  details: z.object({
    inventories: z.array(inventory),
    present: z.record(z.string(), z.array(z.number().int())),
    shared: z.array(shared),
    visibility,
    quality: z.array(quality.nullable()),
    embedding: z.array(z.object({ key: z.string(), similarity: z.number().nullable() })),
    runs: z.object({
      inventory: z.array(z.array(inventory)),
      match: z.array(match),
      quality: z.array(z.array(quality)),
    }),
    flags: z.object({
      no_shared_items: z.boolean(),
      shared_fallback_median_run: z.boolean(),
      visibility_unknown_keys: z.array(z.string()),
      embedding_note: z.string().optional(),
      delivered: z.number().int().min(0).optional(),
      absent: z.array(z.number().int().min(1)).optional(),
    }),
  }),
  judge: z.object({
    model: z.string(),
    prompt_version: z.string(),
    protocol_version: z.string().optional(),
    runs: z.number().int().min(1),
    aggregated: z.literal("median/majority"),
  }),
  embedder: z.object({ model: z.string(), version: z.string() }).nullable(),
  cost_usd: z.number().min(0),
  scored_at: z.string().datetime(),
});

// Compile-time guard: the schema and the MasbResult interface must describe the same shape.
type Parsed = z.infer<typeof MasbResultSchema>;
const _toInterface = (x: Parsed): MasbResult => x;
const _toSchema = (x: MasbResult): Parsed => x;
void _toInterface;
void _toSchema;
