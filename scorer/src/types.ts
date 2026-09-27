/**
 * MASB v0.1 public types. The result JSON written by `masb score` conforms to `MasbResult`.
 * Exported (via `masb-scorer/types`) so the results site can consume the files type-safely.
 */

export const CATEGORIES = [
  "sofa",
  "sectional",
  "armchair",
  "coffee_table",
  "side_table",
  "console",
  "dining_table",
  "dining_chair",
  "bed",
  "nightstand",
  "dresser",
  "desk",
  "office_chair",
  "rug",
  "floor_lamp",
  "table_lamp",
  "wall_art",
  "mirror",
  "plant",
  "curtains",
  "decor",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Normalised bounding box [x0, y0, x1, y1], each 0–1, origin top-left. */
export type BBox = [number, number, number, number];

export interface InventoryItem {
  id: string;
  category: Category;
  description: string;
  bbox: BBox;
}

export interface Inventory {
  items: InventoryItem[];
}

export interface Appearance {
  /** 1-based photo number. */
  photo: number;
  itemId: string;
}

export interface SharedItem {
  key: string;
  category: Category;
  appearances: Appearance[];
  /** 0–4: is it the same physical piece across its appearances. */
  identity: number;
  /** 0–4: is it in the same place relative to fixed room features. */
  placement: number;
}

/** visibility[category][photoNumber] — would this category be visible from that angle if present. */
export type Visibility = Record<string, Record<string, boolean>>;

export interface MatchResult {
  shared: SharedItem[];
  visibility: Visibility;
}

export interface QualityResult {
  realism: number;
  architecture_preserved: boolean;
  notes: string;
}

export interface Scores {
  consistency: number;
  inventory_agreement: number;
  identity_agreement: number;
  placement_agreement: number;
  realism: number;
  architecture_preserved_rate: number;
  /** Mean CLIP cosine similarity of item crops; null when embeddings were unavailable. */
  identity_embedding_similarity: number | null;
}

export interface Details {
  /** Representative inventory per photo (index 0 = photo 1); item ids are the ones `shared` refers to. */
  inventories: Inventory[];
  /** Categories counted present per photo (majority across inventory runs). */
  present: Record<string, number[]>;
  /** Aggregated shared items (median ratings). */
  shared: SharedItem[];
  /** Aggregated visibility (majority). */
  visibility: Visibility;
  /** Aggregated quality per photo (median realism, majority architecture); null for an absent photo. */
  quality: (QualityResult | null)[];
  /** Per-item embedding similarity (null when unavailable). */
  embedding: { key: string; similarity: number | null }[];
  /** Raw per-run judge outputs so disagreement between runs is visible. */
  runs: {
    inventory: Inventory[][]; // [photo][run]
    match: MatchResult[]; // [run]
    quality: QualityResult[][]; // [photo][run]; [] for an absent photo
  };
  flags: {
    no_shared_items: boolean;
    /** No pairwise link reached a majority; the median-consistency match run's shared set was used. */
    shared_fallback_median_run: boolean;
    /** Visibility keys from the judge that did not normalise to a known category / photo (dropped). */
    visibility_unknown_keys: string[];
    embedding_note?: string;
    /** Photos the system delivered (N minus absent). Protocol ≥ 0.1.2. */
    delivered?: number;
    /** 1-based photo numbers the system did not deliver (see PROTOCOL.md "Absent angles"). Protocol ≥ 0.1.2. */
    absent?: number[];
  };
}

export interface MasbResult {
  benchmark: "MASB";
  version: "0.1.0";
  system: string;
  room: string;
  photos: number;
  scores: Scores;
  details: Details;
  judge: { model: string; prompt_version: string; protocol_version?: string; runs: number; aggregated: "median/majority" };
  /** Image embedder used for identity_embedding_similarity; null when none ran. */
  embedder: { model: string; version: string } | null;
  cost_usd: number;
  scored_at: string;
}
