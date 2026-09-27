import sharp from "sharp";
import type { Embedder } from "../src/embed.js";
import type { Judge } from "../src/judge.js";
import type { Inventory, MatchResult, QualityResult, Visibility } from "../src/types.js";

export const tinyJpeg = (color: string) =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: color } }).jpeg().toBuffer();

/** Scripted judge: returns queued answers in call order; counts calls. */
export class FakeJudge implements Judge {
  readonly model = "fake-judge";
  calls = { inventory: 0, match: 0, visibility: 0, quality: 0 };
  /** Originals count seen by each visibility call (it must never see staged photos). */
  visibilityInputs: number[] = [];
  constructor(
    private readonly inv: (photoCall: number) => Inventory,
    private readonly matches: MatchResult[],
    private readonly qualities: QualityResult[],
    private readonly visibilities: Visibility[] = [{}],
  ) {}
  async visibility(originals: Buffer[]): Promise<Visibility> {
    this.visibilityInputs.push(originals.length);
    return this.visibilities[this.calls.visibility++ % this.visibilities.length]!;
  }
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
  readonly model = "fake-embedder";
  readonly version = "0";
  async embed(images: Buffer[]) {
    return images.map(() => [1, 0, 0]);
  }
  costUsd() {
    return 0;
  }
}
