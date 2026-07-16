/* Story-document helpers — pure and shared by server (store, bundle) and client
 * (story editor page). A story owns embedded copies of its characters, scenes,
 * locations and lorebooks; every internal reference (scene→location, scene casts,
 * secret holders, branch successors) points at items of the same document. */

import { v4 as uuidv4 } from "uuid";
import type {
  Character,
  Location,
  Lorebook,
  LorebookEntry,
  Scene,
  StoryDocument,
  StoryScene,
  StorySecret,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const rec = <T,>(v: unknown, fallback: T): T =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as T) : fallback;

// playthroughs ignore aliveness (pacing belongs to the director/narrator), but the
// traits still travel with an embedded copy so copy-to-library keeps them intact
const normalizeAliveness = (a: any): Character["aliveness"] => ({
  initiative: a?.initiative === true,
  timeAware: a?.timeAware === true,
  mindState: a?.mindState === true,
  offscreenLife: a?.offscreenLife === "context" || a?.offscreenLife === "texts" ? a.offscreenLife : "off",
});

export const normalizeCharacter = (c: any): Character => ({
  id: str(c?.id) || uuidv4(),
  name: str(c?.name, "Unnamed"),
  avatarAsset: str(c?.avatarAsset) || null,
  description: str(c?.description),
  greeting: str(c?.greeting),
  exampleDialogue: str(c?.exampleDialogue),
  imagePrompt: str(c?.imagePrompt),
  sprites: rec(c?.sprites, {}),
  spriteSfx: rec(c?.spriteSfx, {}),
  customExpressions: arr(c?.customExpressions)
    .map((x) => ({ name: str(x?.name), description: str(x?.description) }))
    .filter((x) => x.name),
  typingSfxAsset: str(c?.typingSfxAsset) || null,
  trackRelationship: c?.trackRelationship !== false,
  aliveness: normalizeAliveness(c?.aliveness),
  idleMotion: c?.idleMotion !== false,
  tags: arr(c?.tags).map((t) => str(t)).filter(Boolean),
  createdAt: Number(c?.createdAt) || Date.now(),
  updatedAt: Number(c?.updatedAt) || Date.now(),
});

export const normalizeLocation = (l: any): Location => ({
  id: str(l?.id) || uuidv4(),
  name: str(l?.name, "Unnamed place"),
  description: str(l?.description),
  imagePrompt: str(l?.imagePrompt),
  artworkAsset: str(l?.artworkAsset) || null,
  bgmAsset: str(l?.bgmAsset) || null,
  ambientAsset: str(l?.ambientAsset) || null,
  stageStyle: rec(l?.stageStyle, null),
  tags: arr(l?.tags).map((t) => str(t)).filter(Boolean),
  createdAt: Number(l?.createdAt) || Date.now(),
  updatedAt: Number(l?.updatedAt) || Date.now(),
});

export const normalizeScene = (s: any): Scene => ({
  id: str(s?.id) || uuidv4(),
  name: str(s?.name, "Unnamed scene"),
  setup: str(s?.setup),
  imagePrompt: str(s?.imagePrompt),
  locationId: str(s?.locationId) || null,
  artworkAsset: str(s?.artworkAsset) || null,
  bgmAsset: str(s?.bgmAsset) || null,
  ambientAsset: str(s?.ambientAsset) || null,
  stageStyle: rec(s?.stageStyle, null),
  tags: arr(s?.tags).map((t) => str(t)).filter(Boolean),
  createdAt: Number(s?.createdAt) || Date.now(),
  updatedAt: Number(s?.updatedAt) || Date.now(),
});

export const normalizeLorebook = (lb: any): Lorebook => ({
  id: str(lb?.id) || uuidv4(),
  name: str(lb?.name, "Untitled lorebook"),
  description: str(lb?.description),
  entries: arr(lb?.entries).map(
    (e): LorebookEntry => ({
      id: str(e?.id) || uuidv4(),
      title: str(e?.title),
      keywords: arr(e?.keywords).map((k) => str(k)).filter(Boolean),
      content: str(e?.content),
      scanDepth: Number(e?.scanDepth) || 8,
    })
  ),
  tags: arr(lb?.tags).map((t) => str(t)).filter(Boolean),
  createdAt: Number(lb?.createdAt) || Date.now(),
  updatedAt: Number(lb?.updatedAt) || Date.now(),
});

const normalizeSecret = (s: any): StorySecret => ({
  id: str(s?.id) || uuidv4(),
  title: str(s?.title),
  content: str(s?.content),
  knownBy: arr(s?.knownBy).map((x) => str(x)).filter(Boolean),
  revealHint: str(s?.revealHint),
});

const normalizeStoryScene = (e: any): StoryScene => ({
  ...normalizeScene(e),
  cast: arr(e?.cast).map((x) => str(x)).filter(Boolean),
  goal: str(e?.goal),
  obstacles: str(e?.obstacles),
  exit: str(e?.exit),
  pressures: str(e?.pressures),
  successors: arr(e?.successors)
    .map((s) => ({ sceneId: str(s?.sceneId), hint: str(s?.hint) }))
    .filter((s) => s.sceneId),
});

export function emptyStoryDoc(): StoryDocument {
  return {
    name: "",
    description: "",
    destination: "",
    secrets: [],
    characters: [],
    scenes: [],
    locations: [],
    lorebooks: [],
  };
}

/**
 * Fill defaults on a story document and self-heal its internal references so they
 * only ever point at items of this document: scene casts and secret holders drop
 * removed cast members, a scene's locationId drops with its location, and branch
 * successors never point outside the story or back at their own scene.
 */
export function normalizeStoryDoc(d: any): StoryDocument {
  const characters = arr(d?.characters).map(normalizeCharacter);
  const locations = arr(d?.locations).map(normalizeLocation);
  const lorebooks = arr(d?.lorebooks).map(normalizeLorebook);
  const charIds = new Set(characters.map((c) => c.id));
  const locIds = new Set(locations.map((l) => l.id));
  let scenes = arr(d?.scenes).map(normalizeStoryScene);
  const sceneIds = new Set(scenes.map((e) => e.id));
  scenes = scenes.map((e) => ({
    ...e,
    locationId: e.locationId && locIds.has(e.locationId) ? e.locationId : null,
    cast: e.cast.filter((id) => charIds.has(id)),
    successors: e.successors.filter((s) => sceneIds.has(s.sceneId) && s.sceneId !== e.id),
  }));
  const secrets = arr(d?.secrets)
    .map(normalizeSecret)
    .map((s) => ({ ...s, knownBy: s.knownBy.filter((id) => charIds.has(id)) }));
  return {
    name: str(d?.name, "Untitled story"),
    description: str(d?.description),
    destination: str(d?.destination),
    secrets,
    characters,
    scenes,
    locations,
    lorebooks,
  };
}

/**
 * Fresh ids for every embedded item (and secret), with all internal references
 * remapped. Used on bundle import and when copying library items into a story —
 * an embedded copy must never share an id with a library row (relationship/fact
 * tracking keys on library ids, and "no relationships for embedded characters"
 * relies on the miss).
 */
export function remintStoryDoc(d: StoryDocument): StoryDocument {
  const map = new Map<string, string>();
  const remint = (id: string): string => {
    if (!map.has(id)) map.set(id, uuidv4());
    return map.get(id)!;
  };
  return {
    ...d,
    characters: d.characters.map((c) => ({ ...c, id: remint(c.id) })),
    locations: d.locations.map((l) => ({ ...l, id: remint(l.id) })),
    lorebooks: d.lorebooks.map((lb) => ({ ...lb, id: remint(lb.id) })),
    scenes: d.scenes.map((e) => ({
      ...e,
      id: remint(e.id),
      locationId: e.locationId ? remint(e.locationId) : null,
      cast: e.cast.map(remint),
      successors: e.successors.map((s) => ({ ...s, sceneId: remint(s.sceneId) })),
    })),
    secrets: d.secrets.map((s) => ({ ...s, id: uuidv4(), knownBy: s.knownBy.map(remint) })),
  };
}

/** Every asset id a story document (or playthrough snapshot) references. */
export function storyDocAssetIds(d: {
  characters?: Character[];
  scenes?: Scene[];
  locations?: Location[];
}): string[] {
  const out: (string | null | undefined)[] = [];
  for (const c of d.characters ?? []) {
    out.push(c.avatarAsset, c.typingSfxAsset, ...Object.values(c.sprites ?? {}), ...Object.values(c.spriteSfx ?? {}));
  }
  for (const l of d.locations ?? []) out.push(l.artworkAsset, l.bgmAsset, l.ambientAsset);
  for (const s of d.scenes ?? []) out.push(s.artworkAsset, s.bgmAsset, s.ambientAsset);
  return out.filter((x): x is string => !!x);
}
