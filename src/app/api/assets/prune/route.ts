import { handler, ok } from "@/lib/api";
import { deleteAssetObjects, listAssetObjects } from "@/lib/assets";
import { deleteAssets, listAssets, listReferencedAssetIds } from "@/lib/store";

/* Orphans: asset rows and stray bucket objects that no owner references.
 * References live in asset_refs, rewritten transactionally by every store
 * save/delete — no document parsing here. No grace period either: prune is a
 * manual operator action, so an upload sitting in an unsaved editor counts as
 * unused and WILL be removed. */
async function collectOrphans(): Promise<{ ids: string[]; bytes: number }> {
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

/** Dry run: what a prune would remove. */
export const GET = handler(async () => {
  const { ids, bytes } = await collectOrphans();
  return ok({ count: ids.length, bytes });
});

/** Delete orphaned asset rows and their bucket objects (rows first — a failed
 *  object delete leaves a stray the next prune's bucket branch still sees). */
export const POST = handler(async () => {
  const { ids, bytes } = await collectOrphans();
  await deleteAssets(ids);
  await deleteAssetObjects(ids);
  return ok({ removed: ids.length, bytes });
});
