# MASB Scoring Protocol (benchmark v0.1.0, protocol 0.1.3, prompt set 0.1.3)

This document is the contract for the Multi-Angle Staging Benchmark scorer in `scorer/`. It publishes
the judge prompts verbatim, the aggregation rules and the exact formulas. Any change to a prompt or a
formula is a new protocol version; results from different versions are not comparable. Each result
records `judge.prompt_version` and `judge.protocol_version` (both currently `0.1.3`: visibility is
judged by a separate call that sees only the original photos, and absent angles count against
inventory, see "Absent angles"). All published results were scored with 0.1.3.

## Inputs

A **room directory** with two folders, numbered identically:

```
<room-dir>/
  originals/01.jpg 02.jpg 03.jpg ...   # the dataset photos (data/rooms/<id>/NN.jpg)
  staged/01.jpg    02.jpg 03.jpg ...   # one system's staged output for each original
```

`masb prepare <data-room> <staged-dir> <out-room-dir>` assembles one (staged files may be `.jpg`,
`.png` or `.webp`, numbered `01`/`1`/...; they are re-encoded to JPEG). A room needs N ≥ 2 photos.
A staged number missing from `<staged-dir>` is an **absent angle** (the system did not deliver that
photo): `prepare` writes `room.json` with `{"angles": N, "absent": [<photo numbers>]}` and the scorer
penalises it (see "Absent angles"). A staged photo that is missing and not listed in `room.json` is an
error.

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
photo; then this text, with `{N}` = number of photos and `{INVENTORIES}` = JSON object
`{"photo 1": [{id, category, description}, ...], ...}` built from the pinned inventories (see
aggregation). For an absent angle (see "Absent angles") the `Staged i` slot shows the original photo
and its inventory is the empty list.

```text
These photos show ONE room from {N} different camera angles. For each angle you are given the ORIGINAL photo (before staging) followed by the STAGED photo (the same view after virtual staging). The images are labelled in order: "Original 1", "Staged 1", "Original 2", "Staged 2", and so on.

Inventory of the items in each staged photo (item ids are local to each photo):
{INVENTORIES}

Task A: shared items. Find every physical item that appears in two or more staged photos, that is, the same item seen from different angles. Link its inventory entries across photos. If two photos each show an item of the same kind in the same part of the room but the items differ (for example two different sofas), still link them as one shared item and give it a low identity rating. Each inventory entry may belong to at most one shared item. For each shared item rate:
- "identity" 0-4: is it the same physical piece in every appearance (form, colour, material, size)? 4 = clearly identical, 3 = same piece with minor differences, 2 = similar but noticeably different, 1 = same kind but a different piece, 0 = unrelated.
- "placement" 0-4: is it in the same position relative to fixed room features (windows, doors, wall corners, fireplace, built-ins) in every appearance? 4 = same spot, 3 = slightly shifted, 2 = clearly moved within the same area, 1 = a different area of the room, 0 = incompatible positions.

Return:
{"shared": [{"key": "short-name", "category": "sofa", "appearances": [{"photo": 1, "itemId": "i2"}, {"photo": 2, "itemId": "i1"}], "identity": 4, "placement": 4}]}
```

Output: `{ shared: [{ key, category, appearances: [{ photo, itemId }], identity: 0–4, placement: 0–4 }] }`.

After validation the scorer drops appearances that reference an unknown photo or item id, keeps at
most one appearance per photo per shared item, lets each inventory entry belong to only one shared
item, and discards shared items left with fewer than two photos.

### Call 3: visibility (once per room, originals only)

Input: for each angle i, the text `Original i` and the original photo (no staged photo is ever shown
to this call); then this text, with `{N}` = number of photos and `{CATEGORIES}` = the sorted,
comma-separated categories present (by majority, see aggregation) in at least one staged photo.
Skipped when no category is present.

```text
These photos show ONE empty room from {N} different camera angles, before any staging. The images are labelled in order: "Original 1", "Original 2", and so on. The room is to be furnished with items of the categories below, each placed where such an item would normally stand in this room.

For each category below and each angle, say whether an item of that category, standing where it would normally stand in this room, would be in view from that camera (true) or not (false). Decide visibility from the camera angle and room geometry in the ORIGINAL photos only. Mark it false when its position is outside that camera's frame. Mark hidden only when a fixed architectural feature (wall, doorway, column) blocks the view from that angle.
Categories: {CATEGORIES}

Return:
{"visibility": {"sofa": {"1": true, "2": false}}}
```

Output: `{ visibility: { [category]: { [photo]: boolean } } }`. Keys are normalised (category keys:
lower-case, spaces and hyphens to `_`; photo keys: `"01"`, `"photo 1"` → `"1"`); a key that is not an
asked category or not a photo 1..N is dropped and listed in `details.flags.visibility_unknown_keys`.

### Call 4: quality (per photo)

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
- **Match.** Because item ids are pinned, each shared item in a run is a set of pairwise **links**
  between inventory entries (`photo:itemId`). A link is kept when a strict majority of match runs make
  it. Kept links are joined into shared items (connected components, strongest links first, never
  joining two entries of the same photo), so runs that split an item ({1,2,3} / {1,2} / {1,3}) still
  yield one item over photos 1–3. An item's `identity` and `placement` are the **medians** over every
  run item that contributed one of its kept links; its category is the most common among them. If no
  link reaches a majority but some run found shared items, the shared set of the run with the median
  mean(identity, placement) is used and `details.flags.shared_fallback_median_run` is true.
- **Visibility.** `visibility[c][p]` is the strict **majority** over the visibility runs (a run that
  omits the cell counts as visible), for every present category *c* and every photo 1..N.
- **Quality.** Per photo, `realism` is the **median** over runs and `architecture_preserved` the
  strict **majority**; `notes` come from the first run.

(Median of an even count is the mean of the middle two values. Majority ties resolve to false.)

## Formulas

Let N be the number of photos, *present(c)* the set of photos where category *c* is present,
*visible(c)* the set of photos *p* with `visibility[c][p]` true (a missing cell counts as true), and
*S* the aggregated shared items.

```
inventory_agreement = 100 × mean over categories c with |present(c)| ≥ 1 of
                        |present(c) ∩ visible(c)| / |visible(c)|     (ratio = 1 if |visible(c)| = 0)
identity_agreement  = 100 × mean(s.identity  for s in S) / 4         (0 if S is empty)
placement_agreement = 100 × mean(s.placement for s in S) / 4         (0 if S is empty)
consistency         = mean(inventory_agreement, identity_agreement, placement_agreement)

realism                     = 100 × mean(realism over delivered photos) / 4
architecture_preserved_rate = (delivered photos with architecture_preserved) / (delivered photos)  (0–1)
identity_embedding_similarity = mean over s in S of
                                  mean pairwise cosine(CLIP(crop_i), CLIP(crop_j)) over s's appearances
```

- A category that is absent from a photo where the visibility call says it would not be visible
  (outside the frame, or blocked by a wall, doorway or column) is **not** penalised: that photo is not in the
  denominator. An appearance in such a photo does not count either, so it cannot offset an absence
  where the category is expected (present {1,3}, visible {1,2} → 1/2 = 50).
- If *S* is empty, identity and placement are 0 and the result carries `no_shared_items: true`.
- `realism`, `architecture_preserved_rate` and `identity_embedding_similarity` are reported but are
  **not** part of `consistency`.
- Embeddings: each shared item's appearance is cropped by its pinned bounding box from the
  full-resolution staged photo (crops under 8 px are skipped) and embedded with CLIP ViT-L/14 via
  Replicate (`andreasjansson/clip-features`, pinned version
  `75b33f253f7714a281ad3e9b28f63e3232d583716ef6718f2e46641077ea040a`, one prediction per crop). The
  model and version are recorded in the result's `embedder` field. If
  `REPLICATE_API_TOKEN` is unset, `--no-embed` is passed, or the call fails, the value is `null` and
  `details.flags.embedding_note` says why.
- Scores are rounded to 1 decimal (architecture rate to 3, embedding similarity to 3).

## Absent angles

A system that fails to deliver an angle is penalised, not excused. For an absent staged photo *p*:

- **Inventory.** *p*'s inventory is empty (no judge call): no category is present in *p*.
- **Visibility** comes from the visibility call (Call 3), which sees only the N original photos for
  every room, absent angles or not. So every category expected visible from *p* counts as a miss in
  `inventory_agreement`, whatever the match judge does.
- **Match call.** The match call still receives all N angles; *p*'s "Staged" slot shows the original
  photo as a stand-in and *p*'s inventory is the empty list. The stand-in cannot affect visibility
  (a separate call) or inventory (empty by rule), and no shared item can link to *p*.
- **Identity and placement** are computed over the delivered photos only (no shared item can
  reference *p*, which has no items); formulas unchanged.
- **Quality.** No quality call for *p*. `realism` and `architecture_preserved_rate` average over the
  delivered photos only; `details.quality[p]` is `null` and `details.runs.quality[p]` is `[]`.
- **Result.** `photos` stays N. `details.flags.delivered` = N − |absent| and `details.flags.absent`
  lists the absent photo numbers.

Example: three angles, photo 3 absent, a sofa present in photos 1 and 2 and judged visible from all
three: the sofa's ratio is 2/3, so its inventory contribution is 66.7 (unit test in
`test/score.test.ts`).

## Worked example

Three photos. Every inventory run lists a sofa in photos 1–3 and a rug in photos 1–2 (from angle 3
the rug's position is behind a wall). The three match runs return the sofa with (identity, placement) =
(4, 2), (2, 4), (4, 4) and the rug with (4, 4) each time; two of three visibility runs say the rug is
not visible from angle 3. Quality runs per photo give realism 3, 4, 2 and architecture true, true, false.

- Present: sofa {1,2,3}, rug {1,2}. Visible (majority): sofa {1,2,3}, rug {1,2}.
- inventory_agreement = 100 × mean(3/3, 2/2) = **100** (the rug is not penalised for angle 3).
- Sofa identity = median(4, 2, 4) = 4, placement = median(2, 4, 4) = 4; rug 4 and 4.
- identity_agreement = 100 × 4/4 = **100**; placement_agreement = **100**; consistency = **100**.
- Each photo's realism = median(3, 4, 2) = 3 → realism = 100 × 3/4 = **75**; architecture = majority
  (true, true, false) = true → rate **1.0**.

This example is the unit test `test/score.test.ts`. Had the rug been judged visible from angle 3, the
rug ratio would be 2/3 and inventory_agreement 100 × mean(1, 0.667) = 83.3.

## Output

`masb score` writes one JSON file per (system, room), type `MasbResult` in
`scorer/src/types.ts` (importable as `masb-scorer/types`); `MasbResultSchema` in
`scorer/src/schema.ts` validates a file at runtime:

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
    "quality": [ /* aggregated per photo; null for an absent photo */ ],
    "embedding": [ { "key": "...", "similarity": 0.98 } ],
    "runs": { "inventory": [[/* photo 1 runs */]], "match": [/* runs */], "visibility": [/* runs */], "quality": [[/* photo 1 runs */]] },
    "flags": {
      "no_shared_items": false, "shared_fallback_median_run": false,
      "visibility_unknown_keys": [], "embedding_note": "...",  // note only when embeddings are missing
      "delivered": 3, "absent": []
    }
  },
  "judge": { "model": "claude-sonnet-5", "prompt_version": "0.1.3", "protocol_version": "0.1.3", "runs": 3, "aggregated": "median/majority" },
  "embedder": { "model": "replicate:andreasjansson/clip-features", "version": "75b33f25…" } | null,
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

Options for `score`: `--runs <n>` (integer ≥ 1, default 3; an even count warns because it allows ties), `--model <id>` (default `claude-sonnet-5`),
`--effort low|medium|high` (default `medium`), `--no-embed`. Without `--out` the JSON goes to stdout.
`pnpm masb <command>` runs the CLI from source via tsx.

## Cost and time

Per room of N photos: 3N inventory calls, 3 match calls (all 2N images each), 3 visibility calls
(N images each) and 3N quality calls (an absent photo gets no inventory or quality calls). Measured on
3–4-photo rooms: **about $0.20–0.35** of judge usage per room (claude-sonnet-5 list price, $2 / $10
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
- **Visibility is judged from room geometry alone.** The visibility call sees only the original
  photos, never a system's output, so a category is expected from every angle whose frame covers where
  such an item would normally stand. A stager that legitimately keeps a small item (a lamp, a plant, a
  piece of decor) out of one frame is penalised in `inventory_agreement` for that angle. This is the
  price of a visibility judgement that no system can influence. It is why staging-multi-angle's
  inventory moved from 98.6 under protocol 0.1.2 (visibility read from the staged photos) to 92.4
  under 0.1.3. Inventory is therefore best read relative to other systems, not as an absolute rate.
- **Visibility is judged, not measured.** Whether an item "should" be visible from an angle is the
  judge's estimate from the original photos, not a geometric computation.
- **Single style.** v0.1 compares systems in one staging style family; scores across very different
  styles (e.g. sparse vs. dense decor) are not directly comparable, because denser staging has more
  items to disagree about.
- **Small dataset.** v0.1 has three rooms from one property. Treat differences of a few points as
  noise.
- **Run-to-run judge variance.** Re-scoring one room (single-photo family) with the same images moved
  identity by about 8 points (61.1 → 69.4) between independent 3-run scorings. Treat per-room
  differences under ~10 points as within judge noise; system means over rooms are steadier.
- **Realism is not discriminative yet.** In v0.1 every room of every system scored realism 75
  exactly (each photo's median rating was 3), so the realism column does not separate systems.
  Treat it as a sanity check, not a ranking signal, until the quality prompt or scale is revised.
- **No empty-room baseline.** An unstaged room has no items, so consistency is undefined in spirit
  (it scores low and is meaningless); the benchmark measures agreement between staged photos, not whether staging
  happened.
