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

function assetIdsOf(type: BundleItemType, data: any): string[] {
  switch (type) {
    case "character":
      return [data.avatarAsset, data.typingSfxAsset, ...Object.values(data.sprites ?? {})].filter(Boolean);
    case "location":
    case "scene":
      return [data.artworkAsset, data.bgmAsset, data.ambientAsset].filter(Boolean);
    default:
      return [];
  }
}

/** Build a zip bundle for the given items. Stories pull in their scenes; scenes their locations. */
export async function exportBundle(items: { type: BundleItemType; id: string }[]): Promise<Buffer> {
  const expanded = new Map<string, ManifestItem>();
  const add = (type: BundleItemType, id: string) => {
    const key = `${type}:${id}`;
    if (expanded.has(key)) return;
    const data = getters[type](id);
    if (!data) return;
    expanded.set(key, { type, data });
    if (type === "story") for (const sid of data.sceneIds ?? []) add("scene", sid);
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

/** Import a bundle zip. New ids are always generated; references are remapped; names deduped. */
export async function importBundle(buf: Buffer): Promise<{ imported: Record<string, number> }> {
  const zip = await JSZip.loadAsync(buf);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("Not an AnimaChat bundle: manifest.json missing");
  const manifest = JSON.parse(await manifestFile.async("string")) as Manifest;
  if (manifest.app !== "animachat") throw new Error("Not an AnimaChat bundle");

  // assets are content-addressed, so identical files simply land on the same id
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  for (const a of manifest.assets ?? []) {
    const f = zip.file(`assets/${a.id}`);
    if (!f || !/^[a-f0-9]{32}$/.test(a.id)) continue;
    const data = await f.async("nodebuffer");
    fs.writeFileSync(path.join(ASSETS_DIR, a.id), data);
    registerAsset(a.id, a.filename, a.mime, data.length);
  }

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
  for (const it of byType("story")) {
    const fields = prep("story", it.data) as Partial<Story>;
    fields.sceneIds = (fields.sceneIds ?? []).map((sid) => idMap.get(sid)).filter(Boolean) as string[];
    idMap.set(it.data.id, saveStory(fields).id);
    count("story");
  }
  for (const it of byType("character")) {
    idMap.set(it.data.id, saveCharacter(prep("character", it.data) as Partial<Character>).id);
    count("character");
  }
  for (const it of byType("persona")) {
    idMap.set(it.data.id, savePersona(prep("persona", it.data) as Partial<Persona>).id);
    count("persona");
  }
  for (const it of byType("lorebook")) {
    idMap.set(it.data.id, saveLorebook(prep("lorebook", it.data) as Partial<Lorebook>).id);
    count("lorebook");
  }
  return { imported };
}
