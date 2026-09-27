import type { SharedItem } from "./types.js";

/** identity_agreement = 100 × mean(shared.identity) / 4; 0 when nothing is shared. */
export function identityAgreement(shared: SharedItem[]): number {
  if (shared.length === 0) return 0;
  return (100 * shared.reduce((a, s) => a + s.identity, 0)) / shared.length / 4;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Mean pairwise cosine similarity of one item's crop embeddings (null if < 2 crops). */
export function itemEmbeddingSimilarity(vectors: number[][]): number | null {
  const sims: number[] = [];
  for (let i = 0; i < vectors.length; i++)
    for (let j = i + 1; j < vectors.length; j++) sims.push(cosine(vectors[i]!, vectors[j]!));
  return sims.length === 0 ? null : sims.reduce((a, b) => a + b, 0) / sims.length;
}
