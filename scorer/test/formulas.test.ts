import { describe, expect, it } from "vitest";
import { inventoryAgreement, presentByMajority } from "../src/inventory.js";
import { identityAgreement, cosine, itemEmbeddingSimilarity } from "../src/identity.js";
import { placementAgreement } from "../src/placement.js";
import type { Inventory, SharedItem } from "../src/types.js";

const inv = (...cats: string[]): Inventory => ({
  items: cats.map((c, i) => ({ id: `i${i + 1}`, category: c as never, description: c, bbox: [0, 0, 1, 1] })),
});

describe("inventory agreement", () => {
  it("is 100 when every category appears everywhere it should be visible", () => {
    const present = { sofa: [1, 2, 3], rug: [1, 2, 3] };
    expect(inventoryAgreement(present, {}, 3)).toBe(100);
  });

  it("does not penalise an occluded category (visibility false in one photo)", () => {
    // Rug is hidden behind the sofa in photo 3: absent there, but also not expected there.
    const present = { sofa: [1, 2, 3], rug: [1, 2] };
    const visibility = { rug: { "1": true, "2": true, "3": false } };
    expect(inventoryAgreement(present, visibility, 3)).toBe(100);
  });

  it("penalises a category missing from a photo where it should be visible", () => {
    const present = { sofa: [1, 2, 3], rug: [1] };
    const visibility = { rug: { "1": true, "2": true, "3": true } };
    // sofa 3/3 = 1, rug 1/3 → mean 2/3
    expect(inventoryAgreement(present, visibility, 3)).toBeCloseTo(66.667, 2);
  });

  it("clips at 1 when a category appears in more photos than the judge expected", () => {
    const present = { lamp: [1, 2] };
    const visibility = { lamp: { "1": true, "2": false } };
    expect(inventoryAgreement(present, visibility, 2)).toBe(100);
  });

  it("treats a missing visibility row as visible in every photo", () => {
    const present = { plant: [2] };
    expect(inventoryAgreement(present, {}, 2)).toBe(50);
  });

  it("presentByMajority keeps categories listed in a majority of runs per photo", () => {
    const runs = [
      [inv("sofa", "rug"), inv("sofa", "rug", "plant"), inv("sofa")], // photo 1
      [inv("sofa"), inv("sofa"), inv("sofa", "rug")], // photo 2
    ];
    expect(presentByMajority(runs)).toEqual({ sofa: [1, 2], rug: [1] });
  });
});

const shared = (identity: number, placement: number): SharedItem => ({
  key: "k",
  category: "sofa",
  appearances: [{ photo: 1, itemId: "i1" }, { photo: 2, itemId: "i1" }],
  identity,
  placement,
});

describe("identity / placement agreement", () => {
  it("scales mean 0–4 ratings to 100", () => {
    const items = [shared(4, 2), shared(3, 4)];
    expect(identityAgreement(items)).toBe(87.5);
    expect(placementAgreement(items)).toBe(75);
  });
  it("is 0 with no shared items", () => {
    expect(identityAgreement([])).toBe(0);
    expect(placementAgreement([])).toBe(0);
  });
});

describe("embedding similarity", () => {
  it("cosine of identical vectors is 1 and orthogonal is 0", () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it("mean pairwise cosine over an item's appearances", () => {
    expect(itemEmbeddingSimilarity([[1, 0], [1, 0], [0, 1]])).toBeCloseTo(1 / 3);
  });
});
