# MASB Scoring Protocol (v0.1.0)

This document is the contract for the Multi-Angle Staging Benchmark scorer in `scorer/`. It publishes
the judge prompts verbatim, the aggregation rules and the exact formulas. Any change to a prompt or a
formula is a new protocol version; results from different versions are not comparable.

## Inputs

A **room directory** with two folders, numbered identically:

```
<room-dir>/
  originals/01.jpg 02.jpg 03.jpg ...   # the dataset photos (data/rooms/<id>/NN.jpg)
  staged/01.jpg    02.jpg 03.jpg ...   # one system's staged output for each original
```

`masb prepare <data-room> <staged-dir> <out-room-dir>` assembles one (staged files may be `.jpg`,
`.png` or `.webp`, numbered `01`/`1`/...; they are re-encoded to JPEG). A room needs N ≥ 2 photos.

Before judging, every image is auto-rotated and downscaled to at most 1024 px on the long edge
(JPEG q88). Item crops for embeddings are taken from the full-resolution staged photo.

## Judge

- Model: `claude-sonnet-5` (Anthropic Messages API), `max_tokens` 16000, effort `medium`, default
  (adaptive) thinking. The model does not accept sampling parameters, so no `temperature` is sent;
  run-to-run variation is controlled by repeating each call and aggregating (below), and every raw
  run is kept in the result file.
- Every reply must be a single JSON object. It is parsed and validated with a strict schema (zod);
  an invalid reply is retried up to 3 more times, after which scoring fails. Validation normalises a
  category outside the fixed list to `other` and clamps bounding-box coordinates to 0–1.
- Each call is run **3 times** (`--runs`, default 3).

Fixed category list: `sofa, sectional, armchair, coffee_table, side_table, console, dining_table, dining_chair, bed, nightstand, dresser, desk, office_chair, rug, floor_lamp, table_lamp, wall_art, mirror, plant, curtains, decor, other`.

### System prompt (all calls)

```text
You are a careful visual judge for a benchmark of virtually staged real-estate photos. Reply with a single JSON object and nothing else: no prose, no code fences.
```

### Call 1: inventory (per staged photo)

Input: the staged photo, then this text.

```text
This is one virtually staged photo of a room. List every piece of furniture and decor that has been placed in the room (movable items: furniture, rugs, lamps, art, mirrors, plants, curtains, decorative objects). Do not list fixed architecture (walls, windows, doors, floors, ceilings, built-in cabinets, fireplaces, ceiling lights, radiators).

For each item give:
- "id": "i1", "i2", ... in reading order (left to right, then top to bottom)
- "category": exactly one of: sofa, sectional, armchair, coffee_table, side_table, console, dining_table, dining_chair, bed, nightstand, dresser, desk, office_chair, rug, floor_lamp, table_lamp, wall_art, mirror, plant, curtains, decor, other
- "description": a short description of its form, colour and material (at most 15 words)
- "bbox": [x0, y0, x1, y1], the item's bounding box as fractions of the image width and height (0 to 1, origin top-left)

List each physical piece separately (four dining chairs are four items). Return:
{"items": [{"id": "i1", "category": "sofa", "description": "...", "bbox": [0.1, 0.5, 0.4, 0.9]}]}
```

Output: `{ items: [{ id, category, description, bbox: [x0, y0, x1, y1] }] }`.

### Call 2: match (once per room)

Input: for each angle i, the text `Original i`, the original photo, the text `Staged i`, the staged
photo; then this text, with `{N}` = number of photos, `{INVENTORIES}` = JSON object
`{"photo 1": [{id, category, description}, ...], ...}` built from the pinned inventories (see
aggregation), and `{CATEGORIES_PRESENT}` = the sorted, comma-separated categories in those inventories.

```text
These photos show ONE room from {N} different camera angles. For each angle you are given the ORIGINAL photo (before staging) followed by the STAGED photo (the same view after virtual staging). The images are labelled in order: "Original 1", "Staged 1", "Original 2", "Staged 2", and so on.

Inventory of the items in each staged photo (item ids are local to each photo):
{INVENTORIES}

Task A: shared items. Find every physical item that appears in two or more staged photos, that is, the same item seen from different angles. Link its inventory entries across photos. If two photos each show an item of the same kind in the same part of the room but the items differ (for example two different sofas), still link them as one shared item and give it a low identity rating. Each inventory entry may belong to at most one shared item. For each shared item rate:
- "identity" 0-4: is it the same physical piece in every appearance (form, colour, material, size)? 4 = clearly identical, 3 = same piece with minor differences, 2 = similar but noticeably different, 1 = same kind but a different piece, 0 = unrelated.
- "placement" 0-4: is it in the same position relative to fixed room features (windows, doors, wall corners, fireplace, built-ins) in every appearance? 4 = same spot, 3 = slightly shifted, 2 = clearly moved within the same area, 1 = a different area of the room, 0 = incompatible positions.

Task B: visibility. Use the ORIGINAL photos to understand each camera's field of view. For each category below, say whether an item of that category, standing where it stands in the staged photos, would be visible from each angle (true) or would be outside the frame or fully hidden (false).
Categories: {CATEGORIES_PRESENT}

Return:
{"shared": [{"key": "short-name", "category": "sofa", "appearances": [{"photo": 1, "itemId": "i2"}, {"photo": 2, "itemId": "i1"}], "identity": 4, "placement": 4}], "visibility": {"sofa": {"1": true, "2": false}}}
```

Output: `{ shared: [{ key, category, appearances: [{ photo, itemId }], identity: 0–4, placement: 0–4 }],
visibility: { [category]: { [photo]: boolean } } }`.

After validation the scorer drops appearances that reference an unknown photo or item id, keeps at
most one appearance per photo per shared item, lets each inventory entry belong to only one shared
item, and discards shared items left with fewer than two photos.

### Call 3: quality (per photo)

Input: the text `Image 1`, the original photo, the text `Image 2`, the staged photo, then this text.

```text
Image 1 is the ORIGINAL photo of a room. Image 2 is the same photo after virtual staging. Rate the staged photo:
- "realism" 0-4: does it look like a real photograph of a furnished room? Consider scale, perspective, lighting and shadows, contact with the floor, and artefacts. 4 = indistinguishable from a real photo, 3 = minor flaws, 2 = noticeable flaws, 1 = obviously edited, 0 = broken.
- "architecture_preserved" true/false: are the room's fixed features unchanged (walls, windows, doors, floors, ceiling, built-ins, fireplace, the view through windows)? Added movable furniture, rugs, art, curtains and lamps do not count as changes, and neither do small changes in exposure or colour grading.
- "notes": one sentence explaining the ratings.
Return: {"realism": 3, "architecture_preserved": true, "notes": "..."}
```

Output: `{ realism: 0–4, architecture_preserved: boolean, notes }`.

## Aggregation of the 3 runs

- **Inventory.** Category *c* is **present** in photo *p* when a strict majority of *p*'s inventory
  runs list at least one item of category *c*. One run per photo is then **pinned** as that photo's
  item list (the first run whose category set equals the majority set, otherwise the closest one); its
  item ids are what the match call refers to, and its boxes are used for crops.
- **Match.** Because item ids are pinned, a shared item is identified by its set of
  `photo:itemId` appearances. A shared item is kept when a strict majority of match runs report that
  exact appearance set; its `identity` and `placement` are the **medians** over the runs that
  reported it. `visibility[c][p]` is the strict **majority** over runs (a run that omits the cell
  counts as visible).
- **Quality.** Per photo, `realism` is the **median** over runs and `architecture_preserved` the
  strict **majority**; `notes` come from the first run.

(Median of an even count is the mean of the middle two values. Majority ties resolve to false.)

## Formulas

Let N be the number of photos, *present(c)* the set of photos where category *c* is present,
*visible(c)* the set of photos *p* with `visibility[c][p]` true (a missing cell counts as true), and
*S* the aggregated shared items.

```
inventory_agreement = 100 × mean over categories c with |present(c)| ≥ 1 of
                        min(1, |present(c)| / |visible(c)|)          (ratio = 1 if |visible(c)| = 0)
identity_agreement  = 100 × mean(s.identity  for s in S) / 4         (0 if S is empty)
placement_agreement = 100 × mean(s.placement for s in S) / 4         (0 if S is empty)
consistency         = mean(inventory_agreement, identity_agreement, placement_agreement)

realism                     = 100 × mean(realism over photos) / 4
architecture_preserved_rate = (photos with architecture_preserved) / N          (0–1)
identity_embedding_similarity = mean over s in S of
                                  mean pairwise cosine(CLIP(crop_i), CLIP(crop_j)) over s's appearances
```

- A category that is absent from a photo where the judge says it would not be visible (outside the
  frame or occluded) is **not** penalised: that photo is not in the denominator.
- If *S* is empty, identity and placement are 0 and the result carries `no_shared_items: true`.
- `realism`, `architecture_preserved_rate` and `identity_embedding_similarity` are reported but are
  **not** part of `consistency`.
- Embeddings: each shared item's appearance is cropped by its pinned bounding box from the
  full-resolution staged photo (crops under 8 px are skipped) and embedded with CLIP ViT-L/14 via
  Replicate (`andreasjansson/clip-features`, latest version, one prediction per crop). If
  `REPLICATE_API_TOKEN` is unset, `--no-embed` is passed, or the call fails, the value is `null` and
  `details.flags.embedding_note` says why.
- Scores are rounded to 1 decimal (architecture rate to 3, embedding similarity to 3).

## Worked example

Three photos. Every inventory run lists a sofa in photos 1–3 and a rug in photos 1–2 (in photo 3 the
rug is hidden behind the sofa). The three match runs return the sofa with (identity, placement) =
(4, 2), (2, 4), (4, 4) and the rug with (4, 4) each time; two of three runs say the rug is not visible
from angle 3. Quality runs per photo give realism 3, 4, 2 and architecture true, true, false.

- Present: sofa {1,2,3}, rug {1,2}. Visible (majority): sofa {1,2,3}, rug {1,2}.
- inventory_agreement = 100 × mean(3/3, 2/2) = **100** (the occluded rug is not penalised).
- Sofa identity = median(4, 2, 4) = 4, placement = median(2, 4, 4) = 4; rug 4 and 4.
- identity_agreement = 100 × 4/4 = **100**; placement_agreement = **100**; consistency = **100**.
- Each photo's realism = median(3, 4, 2) = 3 → realism = 100 × 3/4 = **75**; architecture = majority
  (true, true, false) = true → rate **1.0**.

This example is the unit test `test/score.test.ts`. Had the rug been judged visible from angle 3, the
rug ratio would be 2/3 and inventory_agreement 100 × mean(1, 0.667) = 83.3.

## Output

`masb score` writes one JSON file per (system, room), type `MasbResult` in
`scorer/src/types.ts` (importable as `masb-scorer/types`):

```jsonc
{
  "benchmark": "MASB", "version": "0.1.0",
  "system": "<name>", "room": "<id>", "photos": 3,
  "scores": {
    "consistency": 0-100, "inventory_agreement": 0-100, "identity_agreement": 0-100,
    "placement_agreement": 0-100, "realism": 0-100, "architecture_preserved_rate": 0-1,
    "identity_embedding_similarity": 0-1 | null
  },
  "details": {
    "inventories": [ /* pinned inventory per photo */ ],
    "present": { "<category>": [1, 2] },
    "shared": [ /* aggregated shared items */ ],
    "visibility": { "<category>": { "1": true } },
    "quality": [ /* aggregated per photo */ ],
    "embedding": [ { "key": "...", "similarity": 0.98 } ],
    "runs": { "inventory": [[/* photo 1 runs */]], "match": [/* runs */], "quality": [[/* photo 1 runs */]] },
    "flags": { "no_shared_items": false, "embedding_note": "..." }
  },
  "judge": { "model": "claude-sonnet-5", "runs": 3, "aggregated": "median" },
  "cost_usd": 0.16,
  "scored_at": "2026-09-27T00:00:00.000Z"
}
```

`details.runs` holds every raw judge reply, so disagreement between runs is visible and any score can
be recomputed from the file.

## How to run

Requires Node 22 and pnpm.

```bash
cd scorer && pnpm install && pnpm build
export ANTHROPIC_API_KEY=...          # required
export REPLICATE_API_TOKEN=...        # optional, for identity_embedding_similarity

# assemble a room dir from the dataset + a system's outputs
node dist/cli.js prepare ../data/rooms/amber-ridge-living ./my-tool-output/living ./rooms/my-tool/amber-ridge-living

# score it
node dist/cli.js score ./rooms/my-tool/amber-ridge-living --system my-tool \
  --room amber-ridge-living --out ../results/my-tool/amber-ridge-living.json

# build the table
node dist/cli.js table ../results --out ../RESULTS.md
```

Options for `score`: `--runs <n>` (default 3), `--model <id>` (default `claude-sonnet-5`),
`--effort low|medium|high` (default `medium`), `--no-embed`. Without `--out` the JSON goes to stdout.
`pnpm masb <command>` runs the CLI from source via tsx.

## Cost and time

Per room of N photos: 3N inventory calls, 3 match calls (all 2N images each) and 3N quality calls.
Measured on a 3-photo room: **about $0.12–0.18** of judge usage (claude-sonnet-5 list price, $2 / $10
per million input / output tokens) and 10–20 s wall time. CLIP embeddings add under $0.001, but a
Replicate account with less than $5 credit is throttled to about 6 predictions per minute, so ~15
crops can take 2–3 minutes. `cost_usd` in each result is the measured spend for that room.

## Limitations

- **Judge bias.** A single vision-language model judges every system. It may favour styles or
  artefacts it finds familiar, and its 0–4 ratings are not calibrated against human raters in v0.1.
  Repetition with median/majority aggregation reduces run-to-run noise but not systematic bias.
  Inventories are not perfectly stable even on identical images (small decor items can come and go
  between runs); the majority rule damps this but does not remove it.
- **Bounding boxes.** Boxes come from the judge and are approximate; they vary between runs, so crop
  embeddings of an identical item score about 0.9–0.98, not 1.0. CLIP similarity between unrelated
  crops of the same room is also high (about 0.8), so the embedding number is only meaningful
  relative to other systems on the same room.
- **Visibility is judged, not measured.** Whether an item "should" be visible from an angle is the
  judge's estimate from the original photos, not a geometric computation.
- **Single style.** v0.1 compares systems in one staging style family; scores across very different
  styles (e.g. sparse vs. dense decor) are not directly comparable, because denser staging has more
  items to disagree about.
- **Small dataset.** v0.1 has three rooms from one property. Treat differences of a few points as
  noise.
- **No empty-room baseline.** An unstaged room has no items, so consistency is undefined in spirit
  (it scores low and is meaningless); the benchmark measures agreement between staged photos, not whether staging
  happened.
