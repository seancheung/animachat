import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { ASSETS_DIR } from "./db";
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

const getters: Record<BundleItemType, (id: string) => any> = {
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
    default:
      return [];
  }
}

/** Write an imported asset only if its bytes hash to its claimed id (ids are
 *  content addresses, so an existing file is by definition identical and is never
 *  overwritten — a manifest can't replace another asset's bytes on disk).
 *  False = the bytes don't match the id; the asset is skipped. */
export function writeVerifiedAsset(id: string, data: Buffer): boolean {
  const file = path.join(ASSETS_DIR, id);
  if (fs.existsSync(file)) return true;
  if (crypto.createHash("sha256").update(data).digest("hex").slice(0, 32) !== id) return false;
  fs.writeFileSync(file, data);
  return true;
}

/** Build a zip bundle for the given items. Stories pull in their cast, scenes and
 *  lorebooks; scenes their locations. */
export async function exportBundle(items: { type: BundleItemType; id: string }[]): Promise<Buffer> {
  const expanded = new Map<string, ManifestItem>();
  const add = (type: BundleItemType, id: string) => {
    const key = `${type}:${id}`;
    if (expanded.has(key)) return;
    const data = getters[type](id);
    if (!data) return;
    expanded.set(key, { type, data });
    if (type === "story") {
      for (const e of data.scenes ?? []) add("scene", e.sceneId);
      for (const cid of data.characterIds ?? []) add("character", cid);
      for (const lid of data.lorebookIds ?? []) add("lorebook", lid);
    }
    if (type === "scene" && data.locationId) add("location", data.locationId);
  };
  for (const it of items) add(it.type, it.id);

  const zip = new JSZip();
  const assets: Manifest["assets"] = [];
  const seenAssets = new Set<string>();
  for (const { type, data } of expanded.values()) {
    for (const aid of assetIdsOf(type, data)) {
      if (seenAssets.has(aid)) continue;
      seenAssets.add(aid);
      const meta = getAsset(aid);
      const file = path.join(ASSETS_DIR, aid);
      if (meta && fs.existsSync(file)) {
        zip.file(`assets/${aid}`, fs.readFileSync(file));
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

/** Bundle-internal dependencies of an item, as `type:id` keys (only ones present in the bundle). */
function requiresOf(item: ManifestItem, present: Set<string>): string[] {
  const req: string[] = [];
  if (item.type === "story") {
    for (const e of item.data.scenes ?? []) req.push(`scene:${e.sceneId}`);
    for (const cid of item.data.characterIds ?? []) req.push(`character:${cid}`);
    for (const lid of item.data.lorebookIds ?? []) req.push(`lorebook:${lid}`);
    // a story scene's location rides in via the scene's own requires
  }
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
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  for (const a of manifest.assets ?? []) {
    if (!wanted.has(a.id)) continue;
    const f = zip.file(`assets/${a.id}`);
    if (!f || !/^[a-f0-9]{32}$/.test(a.id)) continue;
    const data = await f.async("nodebuffer");
    if (!writeVerifiedAsset(a.id, data)) continue;
    registerAsset(a.id, a.filename, a.mime, data.length);
  }

  // the entity phase is fully synchronous — atomic, so a malformed item mid-bundle
  // can't leave a half-imported library (already-written asset files are content-
  // addressed orphans at worst, reclaimed by the prune)
  return inTransaction(() => {
    const existingNames: Record<BundleItemType, Set<string>> = {
      character: new Set(listCharacters().map((x) => x.name.toLowerCase())),
      persona: new Set(listPersonas().map((x) => x.name.toLowerCase())),
      location: new Set(listLocations().map((x) => x.name.toLowerCase())),
      scene: new Set(listScenes().map((x) => x.name.toLowerCase())),
      story: new Set(listStories().map((x) => x.name.toLowerCase())),
      lorebook: new Set(listLorebooks().map((x) => x.name.toLowerCase())),
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
      const saved = saveLocation(prep("location", it.data) as Partial<Location>);
      idMap.set(it.data.id, saved.id);
      count("location");
    }
    for (const it of byType("scene")) {
      const fields = prep("scene", it.data) as Partial<Scene>;
      if (fields.locationId) fields.locationId = idMap.get(fields.locationId) ?? null;
      idMap.set(it.data.id, saveScene(fields).id);
      count("scene");
    }
    for (const it of byType("character")) {
      idMap.set(it.data.id, saveCharacter(prep("character", it.data) as Partial<Character>).id);
      count("character");
    }
    for (const it of byType("lorebook")) {
      idMap.set(it.data.id, saveLorebook(prep("lorebook", it.data) as Partial<Lorebook>).id);
      count("lorebook");
    }
    // stories last — they remap scenes, cast and lorebooks
    for (const it of byType("story")) {
      const fields = prep("story", it.data) as Partial<Story>;
      fields.characterIds = (fields.characterIds ?? [])
        .map((cid) => idMap.get(cid))
        .filter(Boolean) as string[];
      fields.scenes = (fields.scenes ?? []).flatMap((e) => {
        const sceneId = idMap.get(e.sceneId);
        if (!sceneId) return [];
        return [
          {
            ...e,
            sceneId,
            cast: e.cast.map((cid) => idMap.get(cid)).filter(Boolean) as string[],
            // branch targets are scene refs too; dangling ones are dropped by saveStory
            successors: (e.successors ?? []).flatMap((s) => {
              const sid = idMap.get(s.sceneId);
              return sid ? [{ ...s, sceneId: sid }] : [];
            }),
          },
        ];
      });
      // secrets travel with the story; their holders are cast members — remap like the cast
      fields.secrets = (fields.secrets ?? []).map((s) => ({
        ...s,
        knownBy: (s.knownBy ?? []).map((cid) => idMap.get(cid)).filter(Boolean) as string[],
      }));
      fields.lorebookIds = (fields.lorebookIds ?? [])
        .map((lid) => idMap.get(lid))
        .filter(Boolean) as string[];
      idMap.set(it.data.id, saveStory(fields).id);
      count("story");
    }
    for (const it of byType("persona")) {
      idMap.set(it.data.id, savePersona(prep("persona", it.data) as Partial<Persona>).id);
      count("persona");
    }
    return { imported };
  });
}
