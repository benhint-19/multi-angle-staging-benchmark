# Contributing a room set

The Multi-Angle Staging Benchmark (MASB) grows by adding more rooms: real, empty rooms
photographed from several angles. If you have access to a vacant room (a listing, a flip,
a rental between tenants), you can contribute a set.

## Shooting protocol

A compliant room set is 3–4 photos of the same room that follow these rules:

1. **3–4 angles.** Enough views that furniture and features are seen from more than one
   side, but not so many that consecutive shots are nearly identical.
2. **Overlap between consecutive shots.** Each photo should share a meaningful part of the
   room with the photo before and after it, so a viewer (or a scorer) can tell they're the
   same space.
3. **At least one door or window in frame**, in every photo. Doors and windows are fixed
   reference points used to judge whether items are placed consistently across angles.
4. **16–24 mm full-frame-equivalent lens.** Wide enough to show most of the room, not so
   wide that straight lines bow noticeably.
5. **Level camera on a tripod, ~1.0–1.5 m off the floor.** No tilted horizons, no
   handheld shake, roughly eye height for someone seated or a bit lower.
6. **Empty room.** No furniture, no staging, no clutter — just the architecture (walls,
   floor, windows, doors, fixtures).
7. **No people** in any frame.
8. **JPEG straight from the camera.** No retouching, no HDR merges, no filters. We handle
   resizing and stripping metadata on our end.

## Consent and license

By submitting a room set you confirm:

- You own the rights to the photos (you took them, or you have the property owner's/
  photographer's permission to submit them under this license).
- You grant the Multi-Angle Staging Benchmark project a license to publish and
  redistribute the photos under **CC BY 4.0** (see `DATA_LICENSE`), with credit to the
  name you provide.
- The photos contain **no addresses, MLS numbers, or other identifying listing
  information** — visible house numbers, mailboxes, posted signage, or metadata that
  would identify the property's location or an active listing. We remove EXIF/GPS
  metadata on ingest as a backstop, but please don't include identifying info in-frame
  either.

## How to contribute

Email the maintainer or open an issue on this repository with:

- The photos (JPEG, straight from camera).
- The room type (e.g. living, bedroom, kitchen).
- The credit name to use.
- Confirmation of the consent statement above.

We'll package the set the same way the existing rooms are packaged (renamed in shooting
order, resized to a 2048px long edge, metadata stripped) and add it to `data/manifest.json`.
