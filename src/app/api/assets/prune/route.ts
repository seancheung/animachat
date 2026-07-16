import { handler, ok } from "@/lib/api";
import { deleteAssetObjects, listAssetObjects } from "@/lib/assets";
import { assetIdsOf } from "@/lib/bundle";
import { storyDocAssetIds } from "@/lib/storyDoc";
import {
  deleteAssets,
  listAssets,
  listCharacters,
  listChats,
  listLocations,
  listScenes,
  listStories,
} from "@/lib/store";

/** Every asset id the library, a story document, or a playthrough snapshot still points at. */
async function referencedIds(): Promise<Set<string>> {
  const refs = new Set<string>();
  for (const c of await listCharacters()) for (const id of assetIdsOf("character", c)) refs.add(id);
  for (const l of await listLocations()) for (const id of assetIdsOf("location", l)) refs.add(id);
  for (const s of await listScenes()) for (const id of assetIdsOf("scene", s)) refs.add(id);
  // stories embed their items — their documents hold asset refs of their own
  for (const st of await listStories()) for (const id of storyDocAssetIds(st)) refs.add(id);
  // playthroughs are self-contained: their snapshots keep assets alive after
  // the library items (or the story) are deleted
  for (const chat of await listChats()) {
    if (chat.storySnapshot) for (const id of storyDocAssetIds(chat.storySnapshot)) refs.add(id);
  }
  return refs;
}

/** Fresh uploads sit unreferenced until their editor is saved — leave them alone. */
const PRUNE_GRACE_MS = 60 * 60 * 1000;

/** Orphans: asset rows and stray bucket objects that no entity references. */
async function collectOrphans(): Promise<{ ids: string[]; bytes: number }> {
  const refs = await referencedIds();
  const rows = await listAssets();
  const known = new Set(rows.map((r) => r.id));
  const cutoff = Date.now() - PRUNE_GRACE_MS;
  const orphans = new Map<string, number>();
  for (const r of rows) if (!refs.has(r.id) && r.createdAt < cutoff) orphans.set(r.id, r.size);
  for (const o of await listAssetObjects()) {
    if (known.has(o.id) || refs.has(o.id)) continue;
    // object without a DB row (e.g. a direct upload that was never finalized)
    if (o.lastModified >= cutoff) continue;
    orphans.set(o.id, o.size);
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

/** Delete orphaned asset rows and their bucket objects. */
export const POST = handler(async () => {
  const { ids, bytes } = await collectOrphans();
  await deleteAssets(ids);
  await deleteAssetObjects(ids);
  return ok({ removed: ids.length, bytes });
});
