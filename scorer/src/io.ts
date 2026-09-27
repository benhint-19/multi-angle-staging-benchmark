import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const IMAGE = /^(\d+)\.(jpe?g|png|webp)$/i;

/** Numbered images in a directory (01.jpg, 2.png, ...) sorted by number. */
export async function listNumbered(dir: string): Promise<{ n: number; file: string }[]> {
  const names = await readdir(dir);
  const out = names.flatMap((name) => {
    const m = IMAGE.exec(name);
    return m ? [{ n: Number(m[1]), file: join(dir, name) }] : [];
  });
  out.sort((a, b) => a.n - b.n);
  return out;
}

/** Load `originals/` and `staged/` of a room dir; numbering must match. */
export async function loadRoomDir(roomDir: string): Promise<{ originals: Buffer[]; staged: Buffer[] }> {
  const o = await listNumbered(join(roomDir, "originals"));
  const s = await listNumbered(join(roomDir, "staged"));
  const on = o.map((x) => x.n).join(",");
  const sn = s.map((x) => x.n).join(",");
  if (on !== sn) throw new Error(`originals (${on}) and staged (${sn}) numbering differ in ${roomDir}`);
  return {
    originals: await Promise.all(o.map((x) => readFile(x.file))),
    staged: await Promise.all(s.map((x) => readFile(x.file))),
  };
}
