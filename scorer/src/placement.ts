import type { SharedItem } from "./types.js";

/** placement_agreement = 100 × mean(shared.placement) / 4; 0 when nothing is shared. */
export function placementAgreement(shared: SharedItem[]): number {
  if (shared.length === 0) return 0;
  return (100 * shared.reduce((a, s) => a + s.placement, 0)) / shared.length / 4;
}
