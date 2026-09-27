#!/usr/bin/env node
import { Command } from "commander";
import { mkdir, readdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import sharp from "sharp";
import { ReplicateClipEmbedder, type Embedder } from "./embed.js";
import { listNumbered, loadRoomDir } from "./io.js";
import { AnthropicJudge } from "./judge.js";
import { scoreRoom } from "./score.js";
import { renderTable } from "./table.js";
import type { MasbResult } from "./types.js";

const pad = (n: number) => String(n).padStart(2, "0");

async function findResults(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await findResults(p)));
    else if (e.name.endsWith(".json")) out.push(p);
  }
  return out;
}

const program = new Command()
  .name("masb")
  .description("Multi-Angle Staging Benchmark scorer (MASB v0.1)")
  .version("0.1.0");

program
  .command("score")
  .argument("<room-dir>", "directory with originals/NN.jpg and staged/NN.jpg")
  .requiredOption("--system <name>", "name of the staging system being scored")
  .option("--room <id>", "room id (default: basename of room-dir)")
  .option("--out <file>", "write result JSON here (default: stdout)")
  .option("--runs <n>", "judge runs per call (median/majority aggregated)", "3")
  .option("--model <id>", "judge model", "claude-sonnet-5")
  .option("--effort <level>", "judge effort: low | medium | high", "medium")
  .option("--no-embed", "skip CLIP embeddings (identity_embedding_similarity = null)")
  .action(async (roomDir: string, o: { system: string; room?: string; out?: string; runs: string; model: string; effort: "low" | "medium" | "high"; embed: boolean }) => {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
    const runs = Number(o.runs);
    if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be an integer >= 1, got "${o.runs}"`);
    if (runs % 2 === 0) process.stderr.write(`[masb] warning: --runs ${runs} is even; an odd count avoids median/majority ties\n`);
    const { originals, staged } = await loadRoomDir(roomDir);
    let embedder: Embedder | null = null;
    if (o.embed && process.env.REPLICATE_API_TOKEN) embedder = new ReplicateClipEmbedder();
    const result = await scoreRoom({
      system: o.system,
      room: o.room ?? basename(roomDir.replace(/\/+$/, "")),
      originals,
      staged,
      judge: new AnthropicJudge({ model: o.model, effort: o.effort }),
      embedder,
      runs,
      log: (m) => process.stderr.write(`[masb] ${m}\n`),
    });
    const json = JSON.stringify(result, null, 2) + "\n";
    if (o.out) {
      await mkdir(dirname(o.out), { recursive: true });
      await writeFile(o.out, json);
      process.stderr.write(`[masb] consistency ${result.scores.consistency} -> ${o.out} ($${result.cost_usd})\n`);
    } else process.stdout.write(json);
  });

program
  .command("table")
  .argument("<results-dir>", "directory of result JSON files (searched recursively)")
  .option("--out <file>", "write markdown here (default: stdout)")
  .action(async (dir: string, o: { out?: string }) => {
    const results: MasbResult[] = [];
    for (const f of await findResults(dir)) {
      const j = JSON.parse(await readFile(f, "utf8")) as MasbResult;
      if (j.benchmark === "MASB") results.push(j);
    }
    const notesPath = join(dir, "RUN_POLICY.md");
    const notes = existsSync(notesPath) ? await readFile(notesPath, "utf8") : undefined;
    const md = renderTable(results, notes);
    if (o.out) await writeFile(o.out, md);
    else process.stdout.write(md);
  });

program
  .command("prepare")
  .argument("<data-room>", "dataset room dir, e.g. data/rooms/amber-ridge-living")
  .argument("<staged-dir>", "a system's outputs numbered like the originals (01.jpg / 1.png / ...); missing numbers are absent angles")
  .argument("<out-room-dir>", "room dir to create (originals/ + staged/ + room.json)")
  .action(async (dataRoom: string, stagedDir: string, outDir: string) => {
    const originals = await listNumbered(dataRoom);
    const staged = await listNumbered(stagedDir);
    const on = new Set(originals.map((x) => x.n));
    const extra = staged.filter((x) => !on.has(x.n)).map((x) => x.n);
    if (extra.length) throw new Error(`staged photos without an original: ${extra.join(",")}`);
    const sn = new Set(staged.map((x) => x.n));
    const absent = originals.filter((x) => !sn.has(x.n)).map((x) => x.n);
    await mkdir(join(outDir, "originals"), { recursive: true });
    await mkdir(join(outDir, "staged"), { recursive: true });
    for (const x of originals) await copyFile(x.file, join(outDir, "originals", `${pad(x.n)}.jpg`));
    for (const x of staged) await sharp(x.file).rotate().jpeg({ quality: 92 }).toFile(join(outDir, "staged", `${pad(x.n)}.jpg`));
    await writeFile(join(outDir, "room.json"), JSON.stringify({ angles: originals.length, absent }, null, 2) + "\n");
    process.stderr.write(
      `[masb] prepared ${originals.length} photos in ${outDir}${absent.length ? ` (absent: ${absent.join(", ")})` : ""}\n`,
    );
  });

program.parseAsync().catch((err: unknown) => {
  process.stderr.write(`masb: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
