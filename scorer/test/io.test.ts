import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRoomDir } from "../src/io.js";
import { tinyJpeg } from "./fakes.js";

async function room(staged: number[], manifest?: unknown) {
  const dir = await mkdtemp(join(tmpdir(), "masb-io-"));
  await mkdir(join(dir, "originals"));
  await mkdir(join(dir, "staged"));
  const img = await tinyJpeg("#777");
  for (const n of [1, 2, 3]) await writeFile(join(dir, "originals", `0${n}.jpg`), img);
  for (const n of staged) await writeFile(join(dir, "staged", `0${n}.jpg`), img);
  if (manifest) await writeFile(join(dir, "room.json"), JSON.stringify(manifest));
  return dir;
}

describe("loadRoomDir", () => {
  it("returns null for photos listed absent in room.json", async () => {
    const r = await loadRoomDir(await room([1, 2], { angles: 3, absent: [3] }));
    expect(r.originals).toHaveLength(3);
    expect(r.staged.map((b) => b !== null)).toEqual([true, true, false]);
  });
  it("refuses a missing staged photo that room.json does not list", async () => {
    await expect(loadRoomDir(await room([1, 2]))).rejects.toThrow(/not listed absent/);
  });
  it("refuses an absent photo that has a staged file", async () => {
    await expect(loadRoomDir(await room([1, 2, 3], { angles: 3, absent: [3] }))).rejects.toThrow(/listed absent/);
  });
});
