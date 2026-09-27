import sharp from "sharp";
import type { Embedder } from "../src/embed.js";
import type { Judge } from "../src/judge.js";
import type { Inventory, MatchResult, QualityResult } from "../src/types.js";

export const tinyJpeg = (color: string) =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: color } }).jpeg().toBuffer();

/** Scripted judge: returns queued answers in call order; counts calls. */
export class FakeJudge implements Judge {
  readonly model = "fake-judge";
  calls = { inventory: 0, match: 0, quality: 0 };
  constructor(
    private readonly inv: (photoCall: number) => Inventory,
    private readonly matches: MatchResult[],
    private readonly qualities: QualityResult[],
  ) {}
  async inventory(): Promise<Inventory> {
    return this.inv(this.calls.inventory++);
  }
  async match(): Promise<MatchResult> {
    return this.matches[this.calls.match++ % this.matches.length]!;
  }
  async quality(): Promise<QualityResult> {
    return this.qualities[this.calls.quality++ % this.qualities.length]!;
  }
  costUsd() {
    return 0.01;
  }
}

export class FakeEmbedder implements Embedder {
  readonly name = "fake";
  async embed(images: Buffer[]) {
    return images.map(() => [1, 0, 0]);
  }
  costUsd() {
    return 0;
  }
}
