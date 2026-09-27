/** Image embedder for the secondary identity_embedding_similarity number. Inject a fake in tests. */
export interface Embedder {
  readonly name: string;
  embed(images: Buffer[]): Promise<number[][]>;
  costUsd(): number;
}

const API = "https://api.replicate.com/v1";
const MODEL = "andreasjansson/clip-features";
/** Approximate Replicate GPU rate (USD/s) used for cost reporting; CLIP runs take well under a second. */
const USD_PER_SECOND = 0.000225;

interface Prediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  error?: string | null;
  output?: { input: string; embedding: number[] }[] | null;
  metrics?: { predict_time?: number };
  urls: { get: string };
}

/**
 * CLIP ViT-L/14 image features via Replicate (`andreasjansson/clip-features`, 768-d). The model takes
 * http(s) URIs, so each crop is uploaded to the Replicate Files API, embedded in its own prediction,
 * and the upload is deleted afterwards.
 */
export class ReplicateClipEmbedder implements Embedder {
  readonly name = `replicate:${MODEL}`;
  private readonly token: string;
  private seconds = 0;
  private version: string | undefined;

  constructor(token = process.env.REPLICATE_API_TOKEN) {
    if (!token) throw new Error("REPLICATE_API_TOKEN is not set");
    this.token = token;
  }

  costUsd(): number {
    return this.seconds * USD_PER_SECOND;
  }

  private async req<T>(url: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) },
      });
      // Low-credit Replicate accounts are throttled to a few predictions per minute; wait and retry.
      if (res.status !== 429 || attempt >= 20) break;
      const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
      await new Promise((r) => setTimeout(r, 1000 * Math.max(1, body.retry_after ?? 10)));
    }
    if (!res.ok) throw new Error(`Replicate ${init.method ?? "GET"} ${url} -> ${res.status}: ${await res.text()}`);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  private async latestVersion(): Promise<string> {
    if (!this.version) {
      const m = await this.req<{ latest_version: { id: string } }>(`${API}/models/${MODEL}`);
      this.version = m.latest_version.id;
    }
    return this.version;
  }

  private async predict(version: string, url: string): Promise<number[]> {
    let pred = await this.req<Prediction>(`${API}/predictions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "wait" },
      body: JSON.stringify({ version, input: { inputs: url } }),
    });
    for (let i = 0; i < 120 && (pred.status === "starting" || pred.status === "processing"); i++) {
      await new Promise((r) => setTimeout(r, 1000));
      pred = await this.req<Prediction>(pred.urls.get);
    }
    this.seconds += pred.metrics?.predict_time ?? 0;
    const e = pred.output?.[0]?.embedding;
    if (pred.status !== "succeeded" || !e) throw new Error(`CLIP prediction ${pred.status}: ${pred.error}`);
    return e;
  }

  async embed(images: Buffer[]): Promise<number[][]> {
    if (images.length === 0) return [];
    const version = await this.latestVersion();
    const files: { id: string; urls: { get: string } }[] = [];
    try {
      for (const [i, buf] of images.entries()) {
        const form = new FormData();
        form.append("content", new Blob([new Uint8Array(buf)], { type: "image/jpeg" }), `crop-${i}.jpg`);
        files.push(await this.req(`${API}/files`, { method: "POST", body: form }));
      }
      // One prediction per crop: Replicate resolves a Files-API URL only when it is the whole input value
      // (inside a newline-joined list it is passed through unresolved and the model cannot fetch it).
      // Sequential, to stay inside Replicate's prediction rate limit.
      const out: number[][] = [];
      for (const f of files) out.push(await this.predict(version, f.urls.get));
      return out;
    } finally {
      await Promise.allSettled(files.map((f) => this.req(`${API}/files/${f.id}`, { method: "DELETE" })));
    }
  }
}
