import fs from "node:fs";
import path from "node:path";
import { handler, ok } from "@/lib/api";
import { assetIdsOf } from "@/lib/bundle";
import { ASSETS_DIR } from "@/lib/db";
import { deleteAssets, listAssets, listCharacters, listChats, listLocations, listScenes } from "@/lib/store";

/** Every asset id the library — or a playthrough snapshot — still points at. */
function referencedIds(): Set<string> {
  const refs = new Set<string>();
  for (const c of listCharacters()) for (const id of assetIdsOf("character", c)) refs.add(id);
  for (const l of listLocations()) for (const id of assetIdsOf("location", l)) refs.add(id);
  for (const s of listScenes()) for (const id of assetIdsOf("scene", s)) refs.add(id);
  // playthroughs are self-contained: their snapshots keep assets alive after
  // the library items (or the story) are deleted
  for (const chat of listChats()) {
    const snap = chat.storySnapshot;
    if (!snap) continue;
    for (const c of snap.characters) for (const id of assetIdsOf("character", c)) refs.add(id);
    for (const l of snap.locations) for (const id of assetIdsOf("location", l)) refs.add(id);
    for (const { scene } of snap.scenes) for (const id of assetIdsOf("scene", scene)) refs.add(id);
  }
  return refs;
}

/** Orphans: asset rows and stray files on disk that no entity references. */
function collectOrphans(): { ids: string[]; bytes: number } {
  const refs = referencedIds();
  const rows = listAssets();
  const known = new Set(rows.map((r) => r.id));
  const orphans = new Map<string, number>();
  for (const r of rows) if (!refs.has(r.id)) orphans.set(r.id, r.size);
  if (fs.existsSync(ASSETS_DIR)) {
    for (const f of fs.readdirSync(ASSETS_DIR)) {
      if (!/^[a-f0-9]{32}$/.test(f) || known.has(f) || refs.has(f)) continue;
      // file without a DB row (e.g. leftover from a partial restore)
      orphans.set(f, fs.statSync(path.join(ASSETS_DIR, f)).size);
    }
  }
  let bytes = 0;
  for (const size of orphans.values()) bytes += size;
  return { ids: [...orphans.keys()], bytes };
}

/** Dry run: what a prune would remove. */
export const GET = handler(() => {
  const { ids, bytes } = collectOrphans();
  return ok({ count: ids.length, bytes });
});

/** Delete orphaned asset rows and their files. */
export const POST = handler(() => {
  const { ids, bytes } = collectOrphans();
  deleteAssets(ids);
  for (const id of ids) {
    try {
      fs.unlinkSync(path.join(ASSETS_DIR, id));
    } catch {
      /* already gone */
    }
  }
  return ok({ removed: ids.length, bytes });
});
