import { listAssetObjects } from "./assets";
import { listAssets, listReferencedAssetIds } from "./store";

/* Orphans: asset rows and stray bucket objects that no owner references.
 * References live in asset_refs, rewritten transactionally by every store
 * save/delete — no document parsing here. No grace period either: prune is a
 * manual operator action, so an upload sitting in an unsaved editor counts as
 * unused and WILL be removed.
 *
 * This is the PRUNE-side reconciliation and the one place that lists the
 * bucket: it must also catch objects with no DB row at all (a presigned
 * upload that was never finalized) — invisible to any SQL. The settings
 * panel's stats read pure SQL instead (assetStats in the store). */
export async function collectOrphans(): Promise<{ ids: string[]; bytes: number }> {
  const refs = await listReferencedAssetIds();
  const rows = await listAssets();
  const known = new Set(rows.map((r) => r.id));
  const orphans = new Map<string, number>();
  for (const r of rows) if (!refs.has(r.id)) orphans.set(r.id, r.size);
  for (const o of await listAssetObjects()) {
    // object without a DB row (e.g. a direct upload that was never finalized)
    if (!known.has(o.id) && !refs.has(o.id)) orphans.set(o.id, o.size);
  }
  let bytes = 0;
  for (const size of orphans.values()) bytes += size;
  return { ids: [...orphans.keys()], bytes };
}
