import { describe, expect, it } from "vitest";
import { extractJson, inventorySchema, normalizePhotoKey, sanitizeMatch } from "../src/judge.js";

describe("judge parsing", () => {
  it("extracts JSON from fenced replies", () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });
  it("normalises unknown categories to other and clamps bbox", () => {
    const r = inventorySchema.parse({
      items: [{ id: "i1", category: "Bar Stool", description: "x", bbox: [-0.1, 0, 1.2, 0.5] }],
    });
    expect(r.items[0]!.category).toBe("other");
    expect(r.items[0]!.bbox).toEqual([0, 0, 1, 0.5]);
  });
  it("sanitizeMatch drops bad references and single-photo items", () => {
    const inv = [
      { items: [{ id: "i1", category: "sofa" as const, description: "", bbox: [0, 0, 1, 1] as [number, number, number, number] }] },
      { items: [{ id: "i1", category: "sofa" as const, description: "", bbox: [0, 0, 1, 1] as [number, number, number, number] }] },
    ];
    const { match: m } = sanitizeMatch(
      {
        shared: [
          { key: "a", category: "sofa", identity: 4, placement: 4, appearances: [{ photo: 1, itemId: "i1" }, { photo: 2, itemId: "i9" }] },
          { key: "b", category: "sofa", identity: 4, placement: 4, appearances: [{ photo: 1, itemId: "i1" }, { photo: 2, itemId: "i1" }] },
        ],
        visibility: {},
      },
      inv,
    );
    // "a" loses its bad appearance and is dropped without consuming photo1:i1, so "b" keeps it.
    expect(m.shared.map((s) => s.key)).toEqual(["b"]);
  });

  it("normalises visibility keys and reports unknown ones", () => {
    const inv = [0, 1].map(() => ({
      items: [{ id: "i1", category: "coffee_table" as const, description: "", bbox: [0, 0, 1, 1] as [number, number, number, number] }],
    }));
    const { match, unknownKeys } = sanitizeMatch(
      {
        shared: [],
        visibility: {
          "Coffee Table": { "01": true, "photo 2": false, "3": true },
          bar_stool: { "1": true },
        },
      },
      inv,
    );
    expect(match.visibility).toEqual({ coffee_table: { "1": true, "2": false } });
    expect(unknownKeys).toEqual(["photo:Coffee Table/3", "category:bar_stool"]);
  });

  it("normalizePhotoKey", () => {
    expect(normalizePhotoKey("Photo_03")).toBe(3);
    expect(normalizePhotoKey("front")).toBeNull();
  });
});
