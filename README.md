# Multi-Angle Staging Benchmark (MASB)

MASB measures whether virtually staged photos of the same room **agree with each other**.

When a room is staged, it's usually photographed from more than one angle. A good staging
job should look like the same room, furnished the same way, no matter which photo you're
looking at — the same sofa in the same spot, the same rug, the same layout. A bad one
invents a different sofa, or moves the furniture around, from one photo to the next.
Nobody had published a way to check for that. MASB is a small, public dataset of real
rooms plus an open-source scorer that checks it.

## What MASB measures

Given a room with 3–4 photos from different angles, and a staged version of each photo,
MASB scores **cross-view consistency** (0–100), the average of three parts:

1. **Inventory agreement** — do the same furniture and decor items show up in every photo
   they should be visible in?
2. **Identity agreement** — when the same item appears in more than one photo, is it
   recognizably the same piece (shape, color, material, size)?
3. **Placement agreement** — is that item in the same place relative to fixed room
   features (windows, doors, corners, fireplace) across photos?

Two more numbers are reported per room but aren't part of the consistency score:
**realism** (does each staged photo look plausible on its own) and **architecture
preserved** (did staging leave the room's actual structure — walls, windows, floors —
alone).

## How to score

The scorer (`scorer/`) is a Node 22 + TypeScript CLI. It takes a room's original photos and a
tool's staged outputs and produces a consistency score using a fixed, published judge prompt
(`claude-sonnet-5`, each call run 3 times, median taken). `PROTOCOL.md` has the prompts verbatim,
the exact formulas, the output schema and the known limitations.

```bash
cd scorer && pnpm install && pnpm build
export ANTHROPIC_API_KEY=...        # required (judge)
export REPLICATE_API_TOKEN=...      # optional (CLIP crop similarity, a secondary number)

# 1. put a tool's outputs next to the originals (staged files numbered 01, 02, ... like the originals)
node dist/cli.js prepare ../data/rooms/amber-ridge-living ./my-tool-output/living ./rooms/my-tool/amber-ridge-living

# 2. score the room
node dist/cli.js score ./rooms/my-tool/amber-ridge-living --system my-tool \
  --room amber-ridge-living --out ../results/my-tool/amber-ridge-living.json

# 3. rebuild the results table
node dist/cli.js table ../results --out ../RESULTS.md
```

Scoring one 3-photo room costs about $0.12–0.18 in judge usage. Each result file keeps every
raw judge reply, so the numbers can be audited and recomputed. `results/` + `RESULTS.md` hold
the published numbers.

## Dataset

`data/manifest.json` lists each room set: an id, room type, angle count, and path.
Each room directory (`data/rooms/<id>/`) has the numbered original photos (shooting
order) and a `meta.json` with license and credit info. All photos have had metadata
(EXIF, GPS, etc.) stripped and are capped at 2048px on the long edge. See
`DATA_LICENSE` for the data's license (research and evaluation use for the v0.1 Amber Ridge sets; contributed sets are CC BY 4.0) — code in this repo is MIT-licensed
separately (see `LICENSE`).

## How to contribute

The dataset grows by adding more real, empty rooms shot from multiple angles. See
`CONTRIBUTING.md` for the shooting protocol, the consent/license terms, and how to
submit a set — email the maintainer or open an issue on this repository.

## Citation

If you use this dataset or scorer, please cite it — see `CITATION.cff` for the
machine-readable citation, or:

```
Hinton, Ben. "Multi-Angle Staging Benchmark." Version 0.1.0, 2026.
https://github.com/benhint-19/multi-angle-staging-benchmark
```

## Disclosure

This repository contains the benchmark's **data, scorer, and results** only. It does
not describe, and is not a reference implementation of, any particular virtual-staging
system's internals — it measures outputs, not techniques.
