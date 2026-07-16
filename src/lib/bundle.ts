import JSZip from "jszip";
import { ASSET_ID_RE, getAssetBuffer, writeVerifiedAsset } from "./assets";
import {
  getAsset,
  getCharacter,
  getLocation,
  getLorebook,
  getPersona,
  getScene,
  getStory,
  inTransaction,
  listCharacters,
  listLocations,
  listLorebooks,
  listPersonas,
  listScenes,
  listStories,
  registerAsset,
  saveCharacter,
  saveLocation,
  saveLorebook,
  savePersona,
  saveScene,
  saveStory,
} from "./store";
import { normalizeStoryDoc, remintStoryDoc, storyDocAssetIds } from "./storyDoc";
import type { Character, Location, Lorebook, Persona, Scene, Story } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type BundleItemType = "character" | "persona" | "location" | "scene" | "story" | "lorebook";

interface ManifestItem {
  type: BundleItemType;
  data: any;
}

interface Manifest {
  app: "animachat";
  version: 1;
  items: ManifestItem[];
  assets: { id: string; filename: string; mime: string }[];
}

const getters: Record<BundleItemType, (id: string) => Promise<any>> = {
  character: getCharacter,
  persona: getPersona,
  location: getLocation,
  scene: getScene,
  story: getStory,
  lorebook: getLorebook,
};

export function assetIdsOf(type: BundleItemType, data: any): string[] {
  switch (type) {
    case "character":
      return [
        data.avatarAsset,
        data.typingSfxAsset,
        ...Object.values(data.sprites ?? {}),
        ...Object.values(data.spriteSfx ?? {}),
      ].filter(Boolean);
    case "location":
    case "scene":
      return [data.artworkAsset, data.bgmAsset, data.ambientAsset].filter(Boolean);
    case "story":
      // a story document embeds its items — their assets travel with it
      return storyDocAssetIds(data);
    default:
      return [];
  }
}

/** Build a zip bundle for the given items. A story is self-contained (its items
 *  are embedded in the document); library scenes pull in their locations. */
export async function exportBundle(items: { type: BundleItemType; id: string }[]): Promise<Buffer> {
  const expanded = new Map<string, ManifestItem>();
  const add = async (type: BundleItemType, id: string) => {
    const key = `${type}:${id}`;
    if (expanded.has(key)) return;
    const data = await getters[type](id);
    if (!data) return;
    expanded.set(key, { type, data });
    if (type === "scene" && data.locationId) await add("location", data.locationId);
  };
  for (const it of items) await add(it.type, it.id);

  const zip = new JSZip();
  const assets: Manifest["assets"] = [];
  const seenAssets = new Set<string>();
  for (const { type, data } of expanded.values()) {
    for (const aid of assetIdsOf(type, data)) {
      if (seenAssets.has(aid)) continue;
      seenAssets.add(aid);
      const meta = await getAsset(aid);
      const bytes = meta ? await getAssetBuffer(aid) : null;
      if (meta && bytes) {
        zip.file(`assets/${aid}`, bytes);
        assets.push({ id: aid, filename: meta.filename, mime: meta.mime });
      }
    }
  }
  const manifest: Manifest = { app: "animachat", version: 1, items: [...expanded.values()], assets };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function dedupeName(name: string, existing: Set<string>): string {
  if (!existing.has(name.toLowerCase())) return name;
  let i = 2;
  while (existing.has(`${name} (${i})`.toLowerCase())) i++;
  return `${name} (${i})`;
}

const keyOf = (i: ManifestItem) => `${i.type}:${i.data.id}`;

/** Bundle-internal dependencies of an item, as `type:id` keys (only ones present in
 *  the bundle). Stories are self-contained and depend on nothing. */
function requiresOf(item: ManifestItem, present: Set<string>): string[] {
  const req: string[] = [];
  if (item.type === "scene" && item.data.locationId) req.push(`location:${item.data.locationId}`);
  return [...new Set(req)].filter((k) => present.has(k) && k !== keyOf(item));
}

async function readManifest(buf: Buffer): Promise<{ zip: JSZip; manifest: Manifest }> {
  const zip = await JSZip.loadAsync(buf);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("Not an AnimaChat bundle: manifest.json missing");
  const manifest = JSON.parse(await manifestFile.async("string")) as Manifest;
  if (manifest.app !== "animachat") throw new Error("Not an AnimaChat bundle");
  return { zip, manifest };
}

export interface BundlePreviewItem {
  type: BundleItemType;
  id: string;
  name: string;
  /** `type:id` keys of bundle items this one depends on */
  requires: string[];
}

/** List a bundle's contents without importing anything — feeds the import selection dialog. */
export async function previewBundle(buf: Buffer): Promise<{ items: BundlePreviewItem[] }> {
  const { manifest } = await readManifest(buf);
  const present = new Set(manifest.items.map(keyOf));
  return {
    items: manifest.items.map((i) => ({
      type: i.type,
      id: String(i.data.id),
      name: String(i.data.name ?? "(unnamed)"),
      requires: requiresOf(i, present),
    })),
  };
}

/** Import a bundle zip. New ids are always generated; references are remapped; names deduped.
 *  `selected` (as `type:id` keys) limits the import to those items plus their dependencies. */
export async function importBundle(
  buf: Buffer,
  selected?: string[]
): Promise<{ imported: Record<string, number> }> {
  const { zip, manifest } = await readManifest(buf);

  if (selected) {
    const byKey = new Map(manifest.items.map((i) => [keyOf(i), i]));
    const keep = new Set<string>();
    const visit = (k: string) => {
      const it = byKey.get(k);
      if (!it || keep.has(k)) return;
      keep.add(k);
      for (const r of requiresOf(it, new Set(byKey.keys()))) visit(r);
    };
    for (const k of selected) visit(k);
    manifest.items = manifest.items.filter((i) => keep.has(keyOf(i)));
  }

  // assets are content-addressed, so identical files simply land on the same id;
  // only write the ones the (possibly filtered) items actually reference
  const wanted = new Set(manifest.items.flatMap((i) => assetIdsOf(i.type, i.data)));
  for (const a of manifest.assets ?? []) {
    if (!wanted.has(a.id)) continue;
    const f = zip.file(`assets/${a.id}`);
    if (!f || !ASSET_ID_RE.test(a.id)) continue;
    const data = await f.async("nodebuffer");
    if (!(await writeVerifiedAsset(a.id, data, a.mime))) continue;
    await registerAsset(a.id, a.filename, a.mime, data.length);
  }

  // the entity phase runs in one transaction — atomic, so a malformed item
  // mid-bundle can't leave a half-imported library (already-written asset
  // objects are content-addressed orphans at worst, reclaimed by the prune)
  return inTransaction(async () => {
    const existingNames: Record<BundleItemType, Set<string>> = {
      character: new Set((await listCharacters()).map((x) => x.name.toLowerCase())),
      persona: new Set((await listPersonas()).map((x) => x.name.toLowerCase())),
      location: new Set((await listLocations()).map((x) => x.name.toLowerCase())),
      scene: new Set((await listScenes()).map((x) => x.name.toLowerCase())),
      story: new Set((await listStories()).map((x) => x.name.toLowerCase())),
      lorebook: new Set((await listLorebooks()).map((x) => x.name.toLowerCase())),
    };
    const idMap = new Map<string, string>(); // old id -> new id
    const imported: Record<string, number> = {};
    const count = (t: string) => (imported[t] = (imported[t] ?? 0) + 1);
    const byType = (t: BundleItemType) => manifest.items.filter((i) => i.type === t);

    const prep = (type: BundleItemType, data: any) => {
      const { id: _oldId, createdAt: _c, updatedAt: _u, ...fields } = data;
      fields.name = dedupeName(String(fields.name ?? "Imported"), existingNames[type]);
      existingNames[type].add(fields.name.toLowerCase());
      return fields;
    };

    for (const it of byType("location")) {
      const saved = await saveLocation(prep("location", it.data) as Partial<Location>);
      idMap.set(it.data.id, saved.id);
      count("location");
    }
    for (const it of byType("scene")) {
      const fields = prep("scene", it.data) as Partial<Scene>;
      if (fields.locationId) fields.locationId = idMap.get(fields.locationId) ?? null;
      idMap.set(it.data.id, (await saveScene(fields)).id);
      count("scene");
    }
    for (const it of byType("character")) {
      idMap.set(it.data.id, (await saveCharacter(prep("character", it.data) as Partial<Character>)).id);
      count("character");
    }
    for (const it of byType("lorebook")) {
      idMap.set(it.data.id, (await saveLorebook(prep("lorebook", it.data) as Partial<Lorebook>)).id);
      count("lorebook");
    }
    // stories are self-contained documents — remint their embedded ids so an
    // embedded copy can never collide with a library row (relationships/facts
    // key on library ids), then save whole
    for (const it of byType("story")) {
      const fields = prep("story", it.data) as Partial<Story>;
      const reminted = remintStoryDoc(normalizeStoryDoc(fields));
      idMap.set(it.data.id, (await saveStory({ ...fields, ...reminted })).id);
      count("story");
    }
    for (const it of byType("persona")) {
      idMap.set(it.data.id, (await savePersona(prep("persona", it.data) as Partial<Persona>)).id);
      count("persona");
    }
    return { imported };
  });
}
