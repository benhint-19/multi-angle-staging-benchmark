/**
 * MASB v0.1 judge prompts. These strings are published verbatim in PROTOCOL.md (a test enforces it).
 * Changing any of them is a new protocol version.
 */
import { CATEGORIES } from "./types.js";

/** Version of the prompt set below. Bump on any wording change; recorded in every result. */
export const PROMPT_VERSION = "0.1.1";

export const CATEGORY_LIST = CATEGORIES.join(", ");

export const SYSTEM_PROMPT =
  "You are a careful visual judge for a benchmark of virtually staged real-estate photos. " +
  "Reply with a single JSON object and nothing else: no prose, no code fences.";

export const INVENTORY_PROMPT = `This is one virtually staged photo of a room. List every piece of furniture and decor that has been placed in the room (movable items: furniture, rugs, lamps, art, mirrors, plants, curtains, decorative objects). Do not list fixed architecture (walls, windows, doors, floors, ceilings, built-in cabinets, fireplaces, ceiling lights, radiators).

For each item give:
- "id": "i1", "i2", ... in reading order (left to right, then top to bottom)
- "category": exactly one of: ${CATEGORY_LIST}
- "description": a short description of its form, colour and material (at most 15 words)
- "bbox": [x0, y0, x1, y1], the item's bounding box as fractions of the image width and height (0 to 1, origin top-left)

List each physical piece separately (four dining chairs are four items). Return:
{"items": [{"id": "i1", "category": "sofa", "description": "...", "bbox": [0.1, 0.5, 0.4, 0.9]}]}`;

/** Placeholders: {N}, {INVENTORIES}, {CATEGORIES_PRESENT}. */
export const MATCH_PROMPT_TEMPLATE = `These photos show ONE room from {N} different camera angles. For each angle you are given the ORIGINAL photo (before staging) followed by the STAGED photo (the same view after virtual staging). The images are labelled in order: "Original 1", "Staged 1", "Original 2", "Staged 2", and so on.

Inventory of the items in each staged photo (item ids are local to each photo):
{INVENTORIES}

Task A: shared items. Find every physical item that appears in two or more staged photos, that is, the same item seen from different angles. Link its inventory entries across photos. If two photos each show an item of the same kind in the same part of the room but the items differ (for example two different sofas), still link them as one shared item and give it a low identity rating. Each inventory entry may belong to at most one shared item. For each shared item rate:
- "identity" 0-4: is it the same physical piece in every appearance (form, colour, material, size)? 4 = clearly identical, 3 = same piece with minor differences, 2 = similar but noticeably different, 1 = same kind but a different piece, 0 = unrelated.
- "placement" 0-4: is it in the same position relative to fixed room features (windows, doors, wall corners, fireplace, built-ins) in every appearance? 4 = same spot, 3 = slightly shifted, 2 = clearly moved within the same area, 1 = a different area of the room, 0 = incompatible positions.

Task B: visibility. For each category below and each angle, say whether an item of that category, standing where it stands in the room (as shown by the staged photos that contain it), would be in view from that camera (true) or not (false). Decide visibility from the camera angle and room geometry in the ORIGINAL photos only. Do not use whether the item appears in a staged photo. An item missing from a staged photo it should appear in is still visible=true. Mark it false when its position is outside that camera's frame. Mark hidden only when a fixed architectural feature (wall, doorway, column) blocks the view from that angle.
Categories: {CATEGORIES_PRESENT}

Return:
{"shared": [{"key": "short-name", "category": "sofa", "appearances": [{"photo": 1, "itemId": "i2"}, {"photo": 2, "itemId": "i1"}], "identity": 4, "placement": 4}], "visibility": {"sofa": {"1": true, "2": false}}}`;

export const QUALITY_PROMPT = `Image 1 is the ORIGINAL photo of a room. Image 2 is the same photo after virtual staging. Rate the staged photo:
- "realism" 0-4: does it look like a real photograph of a furnished room? Consider scale, perspective, lighting and shadows, contact with the floor, and artefacts. 4 = indistinguishable from a real photo, 3 = minor flaws, 2 = noticeable flaws, 1 = obviously edited, 0 = broken.
- "architecture_preserved" true/false: are the room's fixed features unchanged (walls, windows, doors, floors, ceiling, built-ins, fireplace, the view through windows)? Added movable furniture, rugs, art, curtains and lamps do not count as changes, and neither do small changes in exposure or colour grading.
- "notes": one sentence explaining the ratings.
Return: {"realism": 3, "architecture_preserved": true, "notes": "..."}`;

export function renderMatchPrompt(n: number, inventoriesJson: string, categoriesPresent: string[]): string {
  return MATCH_PROMPT_TEMPLATE.replace("{N}", String(n))
    .replace("{INVENTORIES}", inventoriesJson)
    .replace("{CATEGORIES_PRESENT}", categoriesPresent.join(", "));
}
