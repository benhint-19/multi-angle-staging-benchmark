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

/** `room.json` written by `masb prepare`: the angle count and the photos the system did not deliver. */
export interface RoomManifest {
  angles: number;
  absent: number[];
}

/**
 * Load `originals/` and `staged/` of a room dir. Every original needs a staged photo with the same
 * number unless `room.json` lists it in `absent` (then `staged[i]` is null). Staged photos without
 * an original, and absent photos that do have a staged file, are errors.
 */
export async function loadRoomDir(roomDir: string): Promise<{ originals: Buffer[]; staged: (Buffer | null)[] }> {
  const o = await listNumbered(join(roomDir, "originals"));
  const s = await listNumbered(join(roomDir, "staged"));
  let absent: number[] = [];
  try {
    const m = JSON.parse(await readFile(join(roomDir, "room.json"), "utf8")) as Partial<RoomManifest>;
    absent = Array.isArray(m.absent) ? m.absent.map(Number) : [];
    if (m.angles !== undefined && m.angles !== o.length)
      throw new Error(`room.json angles ${m.angles} but ${o.length} originals in ${roomDir}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const byN = new Map(s.map((x) => [x.n, x.file]));
  const on = new Set(o.map((x) => x.n));
  const extra = s.filter((x) => !on.has(x.n)).map((x) => x.n);
  if (extra.length) throw new Error(`staged photos without an original: ${extra.join(",")} in ${roomDir}`);
  for (const x of o) {
    const listed = absent.includes(x.n);
    if (listed && byN.has(x.n)) throw new Error(`photo ${x.n} is listed absent but has a staged file in ${roomDir}`);
    if (!listed && !byN.has(x.n)) throw new Error(`photo ${x.n} has no staged file and is not listed absent in room.json (${roomDir})`);
  }
  return {
    originals: await Promise.all(o.map((x) => readFile(x.file))),
    staged: await Promise.all(o.map((x) => (byN.has(x.n) ? readFile(byN.get(x.n)!) : Promise.resolve(null)))),
  };
}
