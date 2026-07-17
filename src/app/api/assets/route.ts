import { handler, ok } from "@/lib/api";
import { assetStats } from "@/lib/store";

/** Storage-panel stats — pure SQL (assets ⟕ asset_refs), no bucket call: totals
 *  over finalized uploads plus the unreferenced share a prune would remove.
 *  Bucket-only strays (uploads never finalized) don't show here; the prune
 *  endpoint still sweeps the bucket for them. */
export const GET = handler(async () => ok(await assetStats()));
