import { all, get, run, inTransaction, lockChat, now, uid, type Row } from "./db";
import type {
  Chat,
  Character,
  CharRelationship,
  Fact,
  Lorebook,
  Location,
  Message,
  MessageVariant,
  MindState,
  Model,
  OffscreenNote,
  Persona,
  Provider,
  Relationship,
  Scene,
  SceneEvent,
  Settings,
  Story,
} from "./types";
import { DEFAULT_ALIVENESS, DEFAULT_SETTINGS } from "./types";
import { normalizeStoryDoc } from "./storyDoc";

export { inTransaction };

const J = {
  parse<T>(s: unknown, fallback: T): T {
    if (typeof s !== "string" || !s) return fallback;
    try {
      return JSON.parse(s) as T;
    } catch {
      return fallback;
    }
  },
  str(v: unknown): string {
    return JSON.stringify(v ?? null);
  },
};

/* ---------------- settings ---------------- */

export async function getSettings(): Promise<Settings> {
  const rows = await all("SELECT key, value FROM settings");
  const stored: Record<string, unknown> = {};
  for (const r of rows) {
    // a corrupt row must not override a good default with null (a stored JSON
    // "null" — e.g. defaultModelId — still parses and lands normally)
    const v = J.parse<unknown>(r.value, undefined);
    if (v !== undefined) stored[r.key] = v;
  }
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}

export async function putSettings(patch: Partial<Settings>): Promise<void> {
  await inTransaction(async () => {
    for (const [k, v] of Object.entries(patch))
      await run(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [k, J.str(v)]
      );
  });
}

/* ---------------- providers & models ---------------- */

const providerFromRow = (r: Row): Provider => ({
  id: r.id,
  name: r.name,
  type: r.type,
  baseUrl: r.base_url,
  apiKey: r.api_key,
  createdAt: r.created_at,
});

export async function listProviders(): Promise<Provider[]> {
  return (await all("SELECT * FROM providers ORDER BY created_at")).map(providerFromRow);
}

export async function getProvider(id: string): Promise<Provider | null> {
  const r = await get("SELECT * FROM providers WHERE id=?", [id]);
  return r ? providerFromRow(r) : null;
}

export async function createProvider(
  p: Pick<Provider, "name" | "type" | "baseUrl" | "apiKey">
): Promise<Provider> {
  const id = uid();
  await run("INSERT INTO providers (id, name, type, base_url, api_key, created_at) VALUES (?,?,?,?,?,?)", [
    id, p.name, p.type, p.baseUrl, p.apiKey, now(),
  ]);
  return (await getProvider(id))!;
}

export async function updateProvider(id: string, p: Partial<Provider>): Promise<Provider | null> {
  const cur = await getProvider(id);
  if (!cur) return null;
  const m = { ...cur, ...p };
  await run("UPDATE providers SET name=?, type=?, base_url=?, api_key=? WHERE id=?", [
    m.name, m.type, m.baseUrl, m.apiKey, id,
  ]);
  return getProvider(id);
}

export async function deleteProvider(id: string): Promise<void> {
  await run("DELETE FROM providers WHERE id=?", [id]);
}

const modelFromRow = (r: Row): Model => ({
  id: r.id,
  providerId: r.provider_id,
  modelId: r.model_id,
  displayName: r.display_name,
  contextWindow: r.context_window,
  inputPrice: r.input_price ?? null,
  cacheReadPrice: r.cache_read_price ?? null,
  cacheWritePrice: r.cache_write_price ?? null,
  outputPrice: r.output_price ?? null,
  customBody: J.parse(r.custom_body, null),
  createdAt: r.created_at,
});

export async function listModels(): Promise<Model[]> {
  return (await all("SELECT * FROM models ORDER BY created_at")).map(modelFromRow);
}

export async function getModel(id: string): Promise<Model | null> {
  const r = await get("SELECT * FROM models WHERE id=?", [id]);
  return r ? modelFromRow(r) : null;
}

export async function createModel(
  m: Pick<
    Model,
    "providerId" | "modelId" | "displayName" | "contextWindow" | "inputPrice" | "cacheReadPrice" | "cacheWritePrice" | "outputPrice" | "customBody"
  >
): Promise<Model> {
  const id = uid();
  await run(
    "INSERT INTO models (id, provider_id, model_id, display_name, context_window, input_price, cache_read_price, cache_write_price, output_price, custom_body, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [
      id, m.providerId, m.modelId, m.displayName, m.contextWindow,
      m.inputPrice ?? null, m.cacheReadPrice ?? null, m.cacheWritePrice ?? null, m.outputPrice ?? null,
      m.customBody ? J.str(m.customBody) : null, now(),
    ]
  );
  return (await getModel(id))!;
}

export async function updateModel(id: string, p: Partial<Model>): Promise<Model | null> {
  const cur = await getModel(id);
  if (!cur) return null;
  const m = { ...cur, ...p };
  await run(
    "UPDATE models SET model_id=?, display_name=?, context_window=?, input_price=?, cache_read_price=?, cache_write_price=?, output_price=?, custom_body=? WHERE id=?",
    [
      m.modelId, m.displayName, m.contextWindow,
      m.inputPrice ?? null, m.cacheReadPrice ?? null, m.cacheWritePrice ?? null, m.outputPrice ?? null,
      m.customBody ? J.str(m.customBody) : null, id,
    ]
  );
  return getModel(id);
}

export async function deleteModel(id: string): Promise<void> {
  await run("DELETE FROM models WHERE id=?", [id]);
}

/* Id-preserving insert-or-update, for settings transfer between instances —
   keeps model ids stable so defaultModelId/taskModels references survive. */

export async function upsertProvider(p: Omit<Provider, "createdAt">): Promise<Provider> {
  await run(
    `INSERT INTO providers (id, name, type, base_url, api_key, created_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, type=excluded.type, base_url=excluded.base_url, api_key=excluded.api_key`,
    [p.id, p.name, p.type, p.baseUrl, p.apiKey, now()]
  );
  return (await getProvider(p.id))!;
}

export async function upsertModel(m: Omit<Model, "createdAt">): Promise<Model> {
  await run(
    `INSERT INTO models (id, provider_id, model_id, display_name, context_window, input_price, cache_read_price, cache_write_price, output_price, custom_body, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET provider_id=excluded.provider_id, model_id=excluded.model_id, display_name=excluded.display_name, context_window=excluded.context_window, input_price=excluded.input_price, cache_read_price=excluded.cache_read_price, cache_write_price=excluded.cache_write_price, output_price=excluded.output_price, custom_body=excluded.custom_body`,
    [
      m.id, m.providerId, m.modelId, m.displayName, m.contextWindow,
      m.inputPrice ?? null, m.cacheReadPrice ?? null, m.cacheWritePrice ?? null, m.outputPrice ?? null,
      m.customBody ? J.str(m.customBody) : null, now(),
    ]
  );
  return (await getModel(m.id))!;
}

/* ---------------- generic entity helpers ---------------- */

function touch<T extends { updatedAt: number }>(o: T): T {
  o.updatedAt = now();
  return o;
}

/* ---------------- characters ---------------- */

const characterFromRow = (r: Row): Character => ({
  id: r.id,
  name: r.name,
  avatarAsset: r.avatar_asset,
  description: r.description,
  greeting: r.greeting,
  exampleDialogue: r.example_dialogue,
  imagePrompt: r.image_prompt,
  sprites: J.parse(r.sprites, {}),
  spriteSfx: J.parse(r.sprite_sfx, {}),
  customExpressions: J.parse(r.custom_expressions, []),
  typingSfxAsset: r.typing_sfx_asset,
  trackRelationship: !!r.track_relationship,
  // stored sparse — missing keys mean the defaults, so pre-feature rows are alive
  aliveness: { ...DEFAULT_ALIVENESS, ...J.parse(r.aliveness, {}) },
  idleMotion: !!r.idle_motion,
  tags: J.parse(r.tags, []),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function listCharacters(): Promise<Character[]> {
  return (await all("SELECT * FROM characters ORDER BY name")).map(characterFromRow);
}

export async function getCharacter(id: string): Promise<Character | null> {
  const r = await get("SELECT * FROM characters WHERE id=?", [id]);
  return r ? characterFromRow(r) : null;
}

export async function saveCharacter(c: Partial<Character> & { id?: string }): Promise<Character> {
  const existing = c.id ? await getCharacter(c.id) : null;
  const m: Character = touch({
    id: existing?.id ?? c.id ?? uid(),
    name: "Unnamed",
    avatarAsset: null,
    description: "",
    greeting: "",
    exampleDialogue: "",
    imagePrompt: "",
    sprites: {},
    spriteSfx: {},
    customExpressions: [],
    typingSfxAsset: null,
    trackRelationship: true,
    aliveness: { ...DEFAULT_ALIVENESS },
    idleMotion: true,
    tags: [],
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    ...existing,
    ...c,
  });
  await run(
    `INSERT INTO characters (id,name,avatar_asset,description,greeting,example_dialogue,image_prompt,sprites,sprite_sfx,custom_expressions,typing_sfx_asset,track_relationship,aliveness,idle_motion,tags,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, avatar_asset=excluded.avatar_asset, description=excluded.description, greeting=excluded.greeting,
       example_dialogue=excluded.example_dialogue, image_prompt=excluded.image_prompt, sprites=excluded.sprites, sprite_sfx=excluded.sprite_sfx,
       custom_expressions=excluded.custom_expressions, typing_sfx_asset=excluded.typing_sfx_asset,
       track_relationship=excluded.track_relationship, aliveness=excluded.aliveness, idle_motion=excluded.idle_motion, tags=excluded.tags, updated_at=excluded.updated_at`,
    [
      m.id, m.name, m.avatarAsset, m.description, m.greeting, m.exampleDialogue, m.imagePrompt,
      J.str(m.sprites), J.str(m.spriteSfx), J.str(m.customExpressions), m.typingSfxAsset,
      m.trackRelationship ? 1 : 0, J.str({ ...DEFAULT_ALIVENESS, ...m.aliveness }), m.idleMotion ? 1 : 0,
      J.str(m.tags), m.createdAt, m.updatedAt,
    ]
  );
  return (await getCharacter(m.id))!;
}

export async function deleteCharacter(id: string): Promise<void> {
  await run("DELETE FROM characters WHERE id=?", [id]);
}

/* ---------------- personas ---------------- */

const personaFromRow = (r: Row): Persona => ({
  id: r.id,
  name: r.name,
  description: r.description,
  tags: J.parse(r.tags, []),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function listPersonas(): Promise<Persona[]> {
  return (await all("SELECT * FROM personas ORDER BY name")).map(personaFromRow);
}

export async function getPersona(id: string): Promise<Persona | null> {
  const r = await get("SELECT * FROM personas WHERE id=?", [id]);
  return r ? personaFromRow(r) : null;
}

export async function savePersona(p: Partial<Persona> & { id?: string }): Promise<Persona> {
  const existing = p.id ? await getPersona(p.id) : null;
  const m: Persona = touch({
    id: existing?.id ?? p.id ?? uid(),
    name: "You",
    description: "",
    tags: [],
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    ...existing,
    ...p,
  });
  await run(
    `INSERT INTO personas (id,name,description,tags,created_at,updated_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, tags=excluded.tags, updated_at=excluded.updated_at`,
    [m.id, m.name, m.description, J.str(m.tags), m.createdAt, m.updatedAt]
  );
  return (await getPersona(m.id))!;
}

export async function deletePersona(id: string): Promise<void> {
  await run("DELETE FROM personas WHERE id=?", [id]);
}

/* ---------------- locations ---------------- */

const locationFromRow = (r: Row): Location => ({
  id: r.id,
  name: r.name,
  description: r.description,
  imagePrompt: r.image_prompt,
  artworkAsset: r.artwork_asset,
  bgmAsset: r.bgm_asset,
  ambientAsset: r.ambient_asset,
  stageStyle: J.parse(r.stage_style, null),
  tags: J.parse(r.tags, []),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function listLocations(): Promise<Location[]> {
  return (await all("SELECT * FROM locations ORDER BY name")).map(locationFromRow);
}

export async function getLocation(id: string): Promise<Location | null> {
  const r = await get("SELECT * FROM locations WHERE id=?", [id]);
  return r ? locationFromRow(r) : null;
}

export async function saveLocation(x: Partial<Location> & { id?: string }): Promise<Location> {
  const existing = x.id ? await getLocation(x.id) : null;
  const m: Location = touch({
    id: existing?.id ?? x.id ?? uid(),
    name: "Unnamed place",
    description: "",
    imagePrompt: "",
    artworkAsset: null,
    bgmAsset: null,
    ambientAsset: null,
    stageStyle: null,
    tags: [],
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    ...existing,
    ...x,
  });
  await run(
    `INSERT INTO locations (id,name,description,image_prompt,artwork_asset,bgm_asset,ambient_asset,stage_style,tags,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, image_prompt=excluded.image_prompt, artwork_asset=excluded.artwork_asset, bgm_asset=excluded.bgm_asset, ambient_asset=excluded.ambient_asset, stage_style=excluded.stage_style, tags=excluded.tags, updated_at=excluded.updated_at`,
    [
      m.id, m.name, m.description, m.imagePrompt, m.artworkAsset, m.bgmAsset, m.ambientAsset,
      m.stageStyle ? JSON.stringify(m.stageStyle) : null, J.str(m.tags), m.createdAt, m.updatedAt,
    ]
  );
  return (await getLocation(m.id))!;
}

export async function deleteLocation(id: string): Promise<void> {
  await run("DELETE FROM locations WHERE id=?", [id]);
}

/* ---------------- scenes ---------------- */

const sceneFromRow = (r: Row): Scene => ({
  id: r.id,
  name: r.name,
  setup: r.setup,
  imagePrompt: r.image_prompt,
  locationId: r.location_id,
  artworkAsset: r.artwork_asset,
  bgmAsset: r.bgm_asset,
  ambientAsset: r.ambient_asset,
  stageStyle: J.parse(r.stage_style, null),
  tags: J.parse(r.tags, []),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function listScenes(): Promise<Scene[]> {
  return (await all("SELECT * FROM scenes ORDER BY name")).map(sceneFromRow);
}

export async function getScene(id: string): Promise<Scene | null> {
  const r = await get("SELECT * FROM scenes WHERE id=?", [id]);
  return r ? sceneFromRow(r) : null;
}

export async function saveScene(x: Partial<Scene> & { id?: string }): Promise<Scene> {
  const existing = x.id ? await getScene(x.id) : null;
  const m: Scene = touch({
    id: existing?.id ?? x.id ?? uid(),
    name: "Unnamed scene",
    setup: "",
    imagePrompt: "",
    locationId: null,
    artworkAsset: null,
    bgmAsset: null,
    ambientAsset: null,
    stageStyle: null,
    tags: [],
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    ...existing,
    ...x,
  });
  await run(
    `INSERT INTO scenes (id,name,setup,image_prompt,location_id,artwork_asset,bgm_asset,ambient_asset,stage_style,tags,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, setup=excluded.setup, image_prompt=excluded.image_prompt, location_id=excluded.location_id, artwork_asset=excluded.artwork_asset, bgm_asset=excluded.bgm_asset, ambient_asset=excluded.ambient_asset, stage_style=excluded.stage_style, tags=excluded.tags, updated_at=excluded.updated_at`,
    [
      m.id, m.name, m.setup, m.imagePrompt, m.locationId, m.artworkAsset, m.bgmAsset, m.ambientAsset,
      m.stageStyle ? JSON.stringify(m.stageStyle) : null, J.str(m.tags), m.createdAt, m.updatedAt,
    ]
  );
  return (await getScene(m.id))!;
}

export async function deleteScene(id: string): Promise<void> {
  await run("DELETE FROM scenes WHERE id=?", [id]);
}

/* ---------------- stories ---------------- */

/* A story row stores a self-contained document: the sheet plus embedded
 * characters/scenes/locations/lorebooks (see storyDoc.ts). Every save
 * normalizes and self-heals the document's internal references. */

const storyFromRow = (r: Row): Story => ({
  id: r.id,
  name: r.name,
  description: r.description,
  destination: r.destination ?? "",
  secrets: J.parse(r.secrets, []),
  characters: J.parse(r.characters, []),
  scenes: J.parse(r.scenes, []),
  locations: J.parse(r.locations, []),
  lorebooks: J.parse(r.lorebooks, []),
  tags: J.parse(r.tags, []),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function listStories(): Promise<Story[]> {
  return (await all("SELECT * FROM stories ORDER BY name")).map(storyFromRow);
}

export async function getStory(id: string): Promise<Story | null> {
  const r = await get("SELECT * FROM stories WHERE id=?", [id]);
  return r ? storyFromRow(r) : null;
}

export async function saveStory(x: Partial<Story> & { id?: string }): Promise<Story> {
  const existing = x.id ? await getStory(x.id) : null;
  const merged = { ...existing, ...x };
  const m: Story = {
    id: existing?.id ?? x.id ?? uid(),
    ...normalizeStoryDoc(merged),
    tags: merged.tags ?? [],
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  };
  await run(
    `INSERT INTO stories (id,name,description,destination,secrets,characters,scenes,locations,lorebooks,tags,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, destination=excluded.destination, secrets=excluded.secrets, characters=excluded.characters, scenes=excluded.scenes, locations=excluded.locations, lorebooks=excluded.lorebooks, tags=excluded.tags, updated_at=excluded.updated_at`,
    [
      m.id, m.name, m.description, m.destination,
      J.str(m.secrets), J.str(m.characters), J.str(m.scenes), J.str(m.locations), J.str(m.lorebooks),
      J.str(m.tags), m.createdAt, m.updatedAt,
    ]
  );
  return (await getStory(m.id))!;
}

export async function deleteStory(id: string): Promise<void> {
  await run("DELETE FROM stories WHERE id=?", [id]);
}

/* ---------------- library integrity ---------------- */

/**
 * What still references this library item — a non-empty result blocks deletion.
 * The only chain is location ← scene (stories embed their own copies and never
 * reference the library). Chats never block: playthroughs are self-contained
 * snapshots, casual/immersive chats degrade fail-soft.
 */
export async function libraryReferences(type: "location", id: string): Promise<string[]> {
  const refs: string[] = [];
  if (type === "location") {
    const rows = await all("SELECT name FROM scenes WHERE location_id=? ORDER BY name", [id]);
    for (const r of rows) refs.push(`scene "${r.name}"`);
  }
  return refs;
}

/* ---------------- lorebooks ---------------- */

const lorebookFromRow = (r: Row): Lorebook => ({
  id: r.id,
  name: r.name,
  description: r.description,
  entries: J.parse(r.entries, []),
  tags: J.parse(r.tags, []),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function listLorebooks(): Promise<Lorebook[]> {
  return (await all("SELECT * FROM lorebooks ORDER BY name")).map(lorebookFromRow);
}

export async function getLorebook(id: string): Promise<Lorebook | null> {
  const r = await get("SELECT * FROM lorebooks WHERE id=?", [id]);
  return r ? lorebookFromRow(r) : null;
}

export async function saveLorebook(x: Partial<Lorebook> & { id?: string }): Promise<Lorebook> {
  const existing = x.id ? await getLorebook(x.id) : null;
  const m: Lorebook = touch({
    id: existing?.id ?? x.id ?? uid(),
    name: "Untitled lorebook",
    description: "",
    entries: [],
    tags: [],
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    ...existing,
    ...x,
  });
  await run(
    `INSERT INTO lorebooks (id,name,description,entries,tags,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, entries=excluded.entries, tags=excluded.tags, updated_at=excluded.updated_at`,
    [m.id, m.name, m.description, J.str(m.entries), J.str(m.tags), m.createdAt, m.updatedAt]
  );
  return (await getLorebook(m.id))!;
}

export async function deleteLorebook(id: string): Promise<void> {
  await run("DELETE FROM lorebooks WHERE id=?", [id]);
}

/* ---------------- chats ---------------- */

const chatFromRow = (r: Row): Chat => ({
  id: r.id,
  title: r.title,
  mode: r.mode,
  folder: r.folder,
  tags: J.parse(r.tags, []),
  storyId: r.story_id,
  sceneId: r.scene_id,
  locationId: r.location_id,
  lorebookIds: J.parse(r.lorebook_ids, []),
  characterIds: J.parse(r.character_ids, []),
  personaId: r.persona_id,
  personaCharacterId: r.persona_character_id,
  storySnapshot: J.parse(r.story_snapshot, null),
  nameSnapshots: J.parse(r.name_snapshots, {}),
  modelId: r.model_id,
  charModels: J.parse(r.char_models, {}),
  language: r.language,
  pov: r.pov,
  narratorEnabled: !!r.narrator_enabled,
  playAsNarrator: !!r.play_as_narrator,
  overrides: J.parse(r.overrides, {}),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function listChats(): Promise<Chat[]> {
  return (await all("SELECT * FROM chats ORDER BY updated_at DESC")).map(chatFromRow);
}

export async function getChat(id: string): Promise<Chat | null> {
  const r = await get("SELECT * FROM chats WHERE id=?", [id]);
  return r ? chatFromRow(r) : null;
}

export async function saveChat(x: Partial<Chat> & { id?: string }): Promise<Chat> {
  const existing = x.id ? await getChat(x.id) : null;
  const m: Chat = touch({
    id: existing?.id ?? x.id ?? uid(),
    title: "New chat",
    mode: "casual" as const,
    folder: "",
    tags: [],
    storyId: null,
    sceneId: null,
    locationId: null,
    lorebookIds: [],
    characterIds: [],
    personaId: null,
    personaCharacterId: null,
    storySnapshot: null,
    nameSnapshots: {},
    modelId: null,
    charModels: {},
    language: "",
    pov: "" as const,
    narratorEnabled: false,
    playAsNarrator: false,
    overrides: {},
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    ...existing,
    ...x,
  });
  await run(
    `INSERT INTO chats (id,title,mode,folder,tags,story_id,scene_id,location_id,lorebook_ids,character_ids,persona_id,persona_character_id,story_snapshot,name_snapshots,model_id,char_models,language,pov,narrator_enabled,play_as_narrator,overrides,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, mode=excluded.mode, folder=excluded.folder, tags=excluded.tags, story_id=excluded.story_id, scene_id=excluded.scene_id, location_id=excluded.location_id,
       lorebook_ids=excluded.lorebook_ids, character_ids=excluded.character_ids, persona_id=excluded.persona_id, persona_character_id=excluded.persona_character_id, story_snapshot=excluded.story_snapshot,
       name_snapshots=excluded.name_snapshots, model_id=excluded.model_id, char_models=excluded.char_models,
       language=excluded.language, pov=excluded.pov, narrator_enabled=excluded.narrator_enabled, play_as_narrator=excluded.play_as_narrator, overrides=excluded.overrides, updated_at=excluded.updated_at`,
    [
      m.id, m.title, m.mode, m.folder, J.str(m.tags), m.storyId, m.sceneId, m.locationId,
      J.str(m.lorebookIds), J.str(m.characterIds), m.personaId, m.personaCharacterId,
      m.storySnapshot ? J.str(m.storySnapshot) : null, J.str(m.nameSnapshots), m.modelId, J.str(m.charModels),
      m.language, m.pov, m.narratorEnabled ? 1 : 0, m.playAsNarrator ? 1 : 0, J.str(m.overrides),
      m.createdAt, m.updatedAt,
    ]
  );
  return (await getChat(m.id))!;
}

export async function deleteChat(id: string): Promise<void> {
  await run("DELETE FROM chats WHERE id=?", [id]);
}

export async function touchChat(id: string): Promise<void> {
  await run("UPDATE chats SET updated_at=? WHERE id=?", [now(), id]);
}

/* ---------------- messages ---------------- */

const messageFromRow = (r: Row): Message => ({
  id: r.id,
  chatId: r.chat_id,
  position: r.position,
  role: r.role,
  characterId: r.character_id,
  variants: J.parse(r.variants, []),
  activeVariant: r.active_variant,
  sceneEvent: J.parse(r.scene_event, null),
  createdAt: r.created_at,
});

export async function listMessages(chatId: string): Promise<Message[]> {
  return (await all("SELECT * FROM messages WHERE chat_id=? ORDER BY position", [chatId])).map(messageFromRow);
}

/** One keyset page of a chat's messages, NEWEST first — the client's scroll-up-for-older
 *  timeline. The cursor is the last served row's position (unique per chat). */
export async function pageMessages(
  chatId: string,
  opts: { limit?: number; cursor?: string | null } = {}
): Promise<Page<Message>> {
  const limit = clampLimit(opts.limit);
  const cur = decodeCursor(opts.cursor);
  if (opts.cursor && (!cur || typeof cur.v !== "number")) throw new PageError("invalid cursor");
  const rows = await all(
    `SELECT * FROM messages WHERE chat_id=? ${cur ? "AND position < ?" : ""}
     ORDER BY position DESC LIMIT ?`,
    cur ? [chatId, cur.v, limit + 1] : [chatId, limit + 1]
  );
  const items = rows.slice(0, limit).map(messageFromRow);
  return {
    items,
    nextCursor: rows.length > limit ? encodeCursor({ v: items[items.length - 1].position }) : null,
  };
}

export async function getMessage(id: string): Promise<Message | null> {
  const r = await get("SELECT * FROM messages WHERE id=?", [id]);
  return r ? messageFromRow(r) : null;
}

export async function appendMessage(m: {
  chatId: string;
  role: Message["role"];
  characterId?: string | null;
  content: string;
  emotion?: string | null;
  options?: string[] | null;
  /** raw model output before tag parsing (AI messages only) */
  raw?: string | null;
  sceneEvent?: SceneEvent | null;
}): Promise<Message> {
  // the freeze is destructive (swipes dropped, raw outputs pruned) — atomically
  // paired with the insert so a failed append can't cost the previous tail its
  // alternatives without appending anything
  const id = await inTransaction(async () => {
    // one timeline writer per chat at a time: the row lock serializes the
    // freeze + MAX(position) + insert sequence (SQLite did this by being
    // single-writer; Postgres interleaves)
    await lockChat(m.chatId);
    // freeze the previous tail: alternatives (swipes) live on the newest message only —
    // once a follow-up lands, the chosen variant is the message and the others are dropped
    const prevRow = await get("SELECT * FROM messages WHERE chat_id=? ORDER BY position DESC LIMIT 1", [
      m.chatId,
    ]);
    if (prevRow) {
      const prev = messageFromRow(prevRow);
      if (prev.variants.length > 1) {
        const keptIndex = prev.variants[prev.activeVariant] ? prev.activeVariant : 0;
        await updateMessage(prev.id, { variants: [prev.variants[keptIndex]], activeVariant: 0 });
        // raw outputs follow their variants: keep only the chosen one, re-keyed to 0
        await run("DELETE FROM raw_outputs WHERE message_id=? AND variant_index<>?", [prev.id, keptIndex]);
        await run("UPDATE raw_outputs SET variant_index=0 WHERE message_id=?", [prev.id]);
      }
    }
    const maxRow = await get("SELECT MAX(position) AS p FROM messages WHERE chat_id=?", [m.chatId]);
    const pos = (maxRow?.p ?? -1) + 1;
    const variant: MessageVariant = {
      content: m.content,
      emotion: m.emotion ?? null,
      options: m.options ?? null,
      sceneEvent: m.sceneEvent ?? null,
      createdAt: now(),
    };
    const newId = uid();
    await run(
      `INSERT INTO messages (id, chat_id, position, role, character_id, variants, active_variant, scene_event, created_at)
       VALUES (?,?,?,?,?,?,0,?,?)`,
      [
        newId, m.chatId, pos, m.role, m.characterId ?? null,
        J.str([variant]), m.sceneEvent ? J.str(m.sceneEvent) : null, now(),
      ]
    );
    await touchChat(m.chatId);
    if (m.raw != null) await setRawOutput(newId, 0, m.raw);
    return newId;
  });
  return (await getMessage(id))!;
}

/** Attach a model's raw pre-parse output to a message variant. Debugging data,
 *  database-only: never read by the app, never sent to clients, forks or archives. */
export async function setRawOutput(messageId: string, variantIndex: number, raw: string): Promise<void> {
  await run(
    `INSERT INTO raw_outputs (message_id, variant_index, raw) VALUES (?,?,?)
     ON CONFLICT(message_id, variant_index) DO UPDATE SET raw=excluded.raw`,
    [messageId, variantIndex, raw]
  );
}

export async function updateMessage(
  id: string,
  patch: {
    variants?: MessageVariant[];
    activeVariant?: number;
    sceneEvent?: SceneEvent | null;
  }
): Promise<Message | null> {
  const cur = await getMessage(id);
  if (!cur) return null;
  const variants = [...(patch.variants ?? cur.variants)];
  // clamp to a valid index — a negative/fractional value would poison the
  // variants->content path pageChats reads from this column
  const requested = Number.isInteger(patch.activeVariant) ? (patch.activeVariant as number) : cur.activeVariant;
  const active = Math.max(0, Math.min(requested, Math.max(0, variants.length - 1)));
  // the message-level event is always the ACTIVE variant's: an explicit patch is
  // mirrored onto that variant, and switching variants re-derives it — variants
  // from before events lived on them fall back to the message-level value
  let sceneEvent: SceneEvent | null;
  if (patch.sceneEvent !== undefined) {
    sceneEvent = patch.sceneEvent;
    if (variants[active]) variants[active] = { ...variants[active], sceneEvent };
  } else {
    const v = variants[active];
    sceneEvent = v?.sceneEvent !== undefined ? v.sceneEvent : cur.sceneEvent;
  }
  await run("UPDATE messages SET variants=?, active_variant=?, scene_event=? WHERE id=?", [
    J.str(variants), active, sceneEvent ? J.str(sceneEvent) : null, id,
  ]);
  return getMessage(id);
}

/** Add a regenerated alternative to a message — allowed only while it is still the
 *  chat's newest live message. The generate route streams for a long while between
 *  its up-front tail check and this save, so tail-ness is re-verified here, under
 *  the chat's timeline lock: a message frozen in the meantime (a follow-up landed,
 *  or a concurrent regen finished first) returns null and the variant is discarded
 *  rather than resurrected onto a frozen message. */
export async function addVariant(messageId: string, variant: MessageVariant): Promise<Message | null> {
  const cur = await getMessage(messageId);
  if (!cur) return null;
  return inTransaction(async () => {
    await lockChat(cur.chatId);
    const tail = await get(
      "SELECT id FROM messages WHERE chat_id=? AND role<>'marker' ORDER BY position DESC LIMIT 1",
      [cur.chatId]
    );
    if (tail?.id !== messageId) return null;
    // re-read under the lock — the pre-lock snapshot may be stale
    const fresh = await getMessage(messageId);
    if (!fresh) return null;
    const variants = [...fresh.variants, variant];
    // the message-level sceneEvent re-derives from the new active variant inside updateMessage
    return updateMessage(messageId, { variants, activeVariant: variants.length - 1 });
  });
}

export async function deleteMessage(id: string): Promise<void> {
  await run("DELETE FROM messages WHERE id=?", [id]);
}

/* ---------------- pagination ---------------- */

/** Invalid client-supplied paging input — the route layer maps it to a 400. */
export class PageError extends Error {}

export type LibrarySort = "updated" | "created" | "name";
export interface PageOpts {
  limit?: number;
  cursor?: string | null;
  q?: string;
  tag?: string;
  sort?: LibrarySort;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const PAGE_LIMIT_DEFAULT = 30;
const PAGE_LIMIT_MAX = 100;
export function clampLimit(n: unknown): number {
  if (n == null || n === "") return PAGE_LIMIT_DEFAULT;
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.min(Math.max(v, 1), PAGE_LIMIT_MAX) : PAGE_LIMIT_DEFAULT;
}

export function encodeCursor(c: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}
export function decodeCursor(s: string | null | undefined): Row | null {
  if (!s) return null;
  try {
    const v = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => "\\" + ch);
}
const like = (q: string) => `%${escapeLike(q)}%`;

/** One keyset page over a table. Appends the cursor predicate, ORDER BY and LIMIT n+1
 *  to the caller's filters, and mints the next cursor from the last row served.
 *  The expanded predicate (not a row-value tuple) is used so the name sort can compare
 *  LOWER(name), matching the ORDER BY and the (LOWER(name), id) indexes. */
async function pageQuery<T>(cfg: {
  select: string; // "SELECT t.* FROM characters t" — filters/cursor become the WHERE
  alias?: string; // defaults to "t"
  fromRow: (r: Row) => T;
  where: string[];
  args: unknown[];
  sort: LibrarySort;
  limit: number;
  cursor: string | null;
}): Promise<Page<T>> {
  const t = cfg.alias ?? "t";
  const where = [...cfg.where];
  const args = [...cfg.args];
  const col = cfg.sort === "name" ? "name" : cfg.sort === "created" ? "created_at" : "updated_at";
  const cur = decodeCursor(cfg.cursor);
  if (cfg.cursor && (!cur || typeof cur.id !== "string" || typeof cur.v !== (cfg.sort === "name" ? "string" : "number")))
    throw new PageError("invalid cursor");
  if (cur) {
    if (cfg.sort === "name") {
      where.push(`(LOWER(${t}.name) > LOWER(?) OR (LOWER(${t}.name) = LOWER(?) AND ${t}.id > ?))`);
    } else {
      where.push(`(${t}.${col} < ? OR (${t}.${col} = ? AND ${t}.id < ?))`);
    }
    args.push(cur.v, cur.v, cur.id);
  }
  const order =
    cfg.sort === "name" ? `LOWER(${t}.name), ${t}.id` : `${t}.${col} DESC, ${t}.id DESC`;
  const sql = `${cfg.select}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order} LIMIT ?`;
  const rows = await all(sql, [...args, cfg.limit + 1]);
  const more = rows.length > cfg.limit;
  const page = rows.slice(0, cfg.limit);
  const last = page[page.length - 1];
  return {
    items: page.map(cfg.fromRow),
    nextCursor:
      more && last ? encodeCursor({ v: cfg.sort === "name" ? last.name : last[col], id: last.id }) : null,
  };
}

async function pageLibrary<T>(table: string, fromRow: (r: Row) => T, opts: PageOpts): Promise<Page<T>> {
  const where: string[] = [];
  const args: unknown[] = [];
  const q = opts.q?.trim();
  if (q) {
    // free-text q may fuzzily hit the raw tags JSON; the exact-match tag filter below unnests it
    where.push(`(t.name ILIKE ? ESCAPE '\\' OR t.tags ILIKE ? ESCAPE '\\')`);
    args.push(like(q), like(q));
  }
  if (opts.tag) {
    where.push("EXISTS (SELECT 1 FROM jsonb_array_elements_text(t.tags::jsonb) jt(value) WHERE jt.value = ?)");
    args.push(opts.tag);
  }
  return pageQuery({
    select: `SELECT t.* FROM ${table} t`,
    fromRow,
    where,
    args,
    sort: opts.sort ?? "updated",
    limit: clampLimit(opts.limit),
    cursor: opts.cursor ?? null,
  });
}

export const pageCharacters = (o: PageOpts = {}) => pageLibrary("characters", characterFromRow, o);
export const pagePersonas = (o: PageOpts = {}) => pageLibrary("personas", personaFromRow, o);
export const pageLocations = (o: PageOpts = {}) => pageLibrary("locations", locationFromRow, o);
export const pageScenes = (o: PageOpts = {}) => pageLibrary("scenes", sceneFromRow, o);
export const pageStories = (o: PageOpts = {}) => pageLibrary("stories", storyFromRow, o);
export const pageLorebooks = (o: PageOpts = {}) => pageLibrary("lorebooks", lorebookFromRow, o);

export interface ChatListRow extends Chat {
  messageCount: number;
  lastMessage: string;
  ended: boolean;
  storyName: string | null;
}

/** Chat list page, newest-updated first, with the row decorations computed in SQL
 *  (the message subqueries ride idx_messages_chat) instead of hydrating timelines.
 *  `kind` splits the two surfaces: the Chats page lists casual/immersive only,
 *  the Stories page lists playthroughs. */
export async function pageChats(
  opts: {
    limit?: number;
    cursor?: string | null;
    q?: string;
    folder?: string;
    kind?: "chats" | "playthroughs";
  } = {}
): Promise<Page<ChatListRow>> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.kind === "playthroughs") where.push("c.mode = 'story'");
  else if (opts.kind === "chats") where.push("c.mode <> 'story'");
  if (opts.folder) {
    where.push("c.folder = ?");
    args.push(opts.folder);
  }
  const q = opts.q?.trim();
  if (q) {
    const l = like(q);
    // live character names first (renames keep matching); name_snapshots covers deleted ones
    where.push(`(c.title ILIKE ? ESCAPE '\\'
       OR c.tags ILIKE ? ESCAPE '\\'
       OR c.name_snapshots ILIKE ? ESCAPE '\\'
       OR p.name ILIKE ? ESCAPE '\\'
       OR c.story_snapshot::jsonb ->> 'name' ILIKE ? ESCAPE '\\'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(c.character_ids::jsonb) je(value)
                  JOIN characters ch ON ch.id = je.value
                  WHERE ch.name ILIKE ? ESCAPE '\\'))`);
    args.push(l, l, l, l, l, l);
  }
  const select = `SELECT c.*,
    (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS _message_count,
    (SELECT left((m.variants::jsonb -> m.active_variant) ->> 'content', 120)
       FROM messages m WHERE m.chat_id = c.id AND m.role <> 'marker'
       ORDER BY m.position DESC LIMIT 1) AS _last_message,
    EXISTS (SELECT 1 FROM messages m
       WHERE m.chat_id = c.id AND (m.scene_event::jsonb ->> 'theEnd')::boolean) AS _ended,
    c.story_snapshot::jsonb ->> 'name' AS _story_name
  FROM chats c LEFT JOIN personas p ON p.id = c.persona_id`;
  return pageQuery({
    select,
    alias: "c",
    fromRow: (r) => ({
      ...chatFromRow(r),
      messageCount: r._message_count ?? 0,
      lastMessage: r._last_message ?? "",
      ended: !!r._ended,
      storyName: r._story_name ?? null,
    }),
    where,
    args,
    sort: "updated",
    limit: clampLimit(opts.limit),
    cursor: opts.cursor ?? null,
  });
}

const LIBRARY_TABLES = {
  character: "characters",
  persona: "personas",
  location: "locations",
  scene: "scenes",
  story: "stories",
  lorebook: "lorebooks",
} as const;
export type LibraryType = keyof typeof LIBRARY_TABLES;
export const LIBRARY_TYPE_KEYS = Object.keys(LIBRARY_TABLES) as LibraryType[];

export interface LibraryNameRef {
  type: LibraryType;
  id: string;
  name: string;
}

/** Name search across the whole library (or one type, or a `types` subset): one merged,
 *  name-ordered stream with a single 3-part cursor {v: name, t: type, id}. */
export async function searchLibraryNames(
  opts: { q?: string; type?: LibraryType; types?: LibraryType[]; limit?: number; cursor?: string | null } = {}
): Promise<Page<LibraryNameRef>> {
  const types = opts.types ?? (opts.type ? [opts.type] : LIBRARY_TYPE_KEYS);
  const q = opts.q?.trim();
  const limit = clampLimit(opts.limit);
  const parts: string[] = [];
  const args: unknown[] = [];
  for (const ty of types) {
    parts.push(`SELECT '${ty}' AS type, id, name FROM ${LIBRARY_TABLES[ty]}${q ? ` WHERE name ILIKE ? ESCAPE '\\'` : ""}`);
    if (q) args.push(like(q));
  }
  const cur = decodeCursor(opts.cursor ?? null);
  if (
    opts.cursor &&
    (!cur || typeof cur.v !== "string" || typeof cur.t !== "string" || typeof cur.id !== "string")
  )
    throw new PageError("invalid cursor");
  let sql = `SELECT * FROM (${parts.join(" UNION ALL ")}) u`;
  if (cur) {
    sql += ` WHERE (LOWER(name) > LOWER(?) OR (LOWER(name) = LOWER(?) AND (type > ? OR (type = ? AND id > ?))))`;
    args.push(cur.v, cur.v, cur.t, cur.t, cur.id);
  }
  sql += ` ORDER BY LOWER(name), type, id LIMIT ?`;
  const rows = await all(sql, [...args, limit + 1]);
  const more = rows.length > limit;
  const page = rows.slice(0, limit) as LibraryNameRef[];
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: more && last ? encodeCursor({ v: last.name, t: last.type, id: last.id }) : null,
  };
}

export async function listDistinctTags(type: LibraryType): Promise<string[]> {
  const rows = await all(
    `SELECT jt.value AS tag FROM ${LIBRARY_TABLES[type]} t, jsonb_array_elements_text(t.tags::jsonb) jt(value)
     GROUP BY jt.value ORDER BY LOWER(jt.value), jt.value`
  );
  return rows.map((r) => String(r.tag));
}

export async function listChatFolders(): Promise<string[]> {
  return (await all("SELECT DISTINCT folder FROM chats WHERE folder <> '' ORDER BY folder")).map(
    (r) => r.folder
  );
}

/* ---------------- memory: summaries, facts, relationships ---------------- */

export async function getSummary(chatId: string): Promise<{ content: string; coveredPosition: number }> {
  const r = await get("SELECT * FROM summaries WHERE chat_id=?", [chatId]);
  return r ? { content: r.content, coveredPosition: r.covered_position } : { content: "", coveredPosition: -1 };
}

export async function putSummary(chatId: string, content: string, coveredPosition: number): Promise<void> {
  await run(
    `INSERT INTO summaries (chat_id, content, covered_position, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(chat_id) DO UPDATE SET content=excluded.content, covered_position=excluded.covered_position, updated_at=excluded.updated_at`,
    [chatId, content, coveredPosition, now()]
  );
}

/** Invalidate summary coverage from a position onward (edit/rewind touching summarized range). */
export async function invalidateSummary(chatId: string, fromPosition: number): Promise<void> {
  const s = await getSummary(chatId);
  if (s.coveredPosition >= fromPosition) {
    // Drop the whole summary: chunks are merged, so partial rollback is impossible.
    await run("DELETE FROM summaries WHERE chat_id=?", [chatId]);
  }
}

const factFromRow = (r: Row): Fact => ({
  id: r.id,
  characterId: r.character_id,
  chatId: r.chat_id,
  content: r.content,
  createdAt: r.created_at,
});

export async function listFacts(characterId: string, limit = 100): Promise<Fact[]> {
  return (
    await all("SELECT * FROM facts WHERE character_id=? ORDER BY created_at DESC LIMIT ?", [characterId, limit])
  ).map(factFromRow);
}

export async function addFact(characterId: string, chatId: string | null, content: string): Promise<Fact> {
  const id = uid();
  await run("INSERT INTO facts (id, character_id, chat_id, content, created_at) VALUES (?,?,?,?,?)", [
    id, characterId, chatId, content, now(),
  ]);
  return factFromRow((await get("SELECT * FROM facts WHERE id=?", [id]))!);
}

export async function deleteFact(id: string): Promise<void> {
  await run("DELETE FROM facts WHERE id=?", [id]);
}

const relationshipFromRow = (r: Row): Relationship => ({
  id: r.id,
  characterId: r.character_id,
  personaId: r.persona_id,
  affinity: r.affinity,
  notes: r.notes,
  updatedAt: r.updated_at,
});

export async function getRelationship(characterId: string, personaId: string): Promise<Relationship | null> {
  const r = await get("SELECT * FROM relationships WHERE character_id=? AND persona_id=?", [
    characterId, personaId,
  ]);
  return r ? relationshipFromRow(r) : null;
}

export async function listRelationships(characterId: string): Promise<Relationship[]> {
  return (await all("SELECT * FROM relationships WHERE character_id=?", [characterId])).map(relationshipFromRow);
}

/** Reset: forget all relationship data for a character (all personas). */
export async function deleteRelationships(characterId: string): Promise<void> {
  await run("DELETE FROM relationships WHERE character_id=?", [characterId]);
}

export async function putRelationship(
  characterId: string,
  personaId: string,
  affinity: number,
  notes: string
): Promise<void> {
  await run(
    `INSERT INTO relationships (id, character_id, persona_id, affinity, notes, updated_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(character_id, persona_id) DO UPDATE SET affinity=excluded.affinity, notes=excluded.notes, updated_at=excluded.updated_at`,
    [uid(), characterId, personaId, Math.max(-100, Math.min(100, Math.round(affinity))), notes, now()]
  );
}

/* ---- aliveness: per-chat mind states & off-screen life notes ---- */

export async function getMindState(characterId: string, chatId: string): Promise<MindState | null> {
  const r = await get("SELECT * FROM mind_states WHERE character_id=? AND chat_id=?", [characterId, chatId]);
  return r
    ? { characterId: r.character_id, chatId: r.chat_id, content: r.content, updatedAt: r.updated_at }
    : null;
}

export async function putMindState(characterId: string, chatId: string, content: string): Promise<void> {
  await run(
    `INSERT INTO mind_states (character_id, chat_id, content, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(character_id, chat_id) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at`,
    [characterId, chatId, content, now()]
  );
}

export async function getOffscreenNote(characterId: string, chatId: string): Promise<OffscreenNote | null> {
  const r = await get("SELECT * FROM offscreen_notes WHERE character_id=? AND chat_id=?", [
    characterId, chatId,
  ]);
  return r
    ? { characterId: r.character_id, chatId: r.chat_id, content: r.content, createdAt: r.created_at }
    : null;
}

export async function putOffscreenNote(characterId: string, chatId: string, content: string): Promise<void> {
  await run(
    `INSERT INTO offscreen_notes (character_id, chat_id, content, created_at) VALUES (?,?,?,?)
     ON CONFLICT(character_id, chat_id) DO UPDATE SET content=excluded.content, created_at=excluded.created_at`,
    [characterId, chatId, content, now()]
  );
}

/* ---- character ↔ character (directed: each side has their own view) ---- */

const charRelationshipFromRow = (r: Row): CharRelationship => ({
  id: r.id,
  characterId: r.character_id,
  otherId: r.other_id,
  affinity: r.affinity,
  notes: r.notes,
  updatedAt: r.updated_at,
});

export async function getCharRelationship(characterId: string, otherId: string): Promise<CharRelationship | null> {
  const r = await get("SELECT * FROM char_relationships WHERE character_id=? AND other_id=?", [
    characterId, otherId,
  ]);
  return r ? charRelationshipFromRow(r) : null;
}

export async function listCharRelationships(characterId: string): Promise<CharRelationship[]> {
  return (await all("SELECT * FROM char_relationships WHERE character_id=?", [characterId])).map(
    charRelationshipFromRow
  );
}

/** Reset: forget a character's views of others AND others' views of them. */
export async function deleteCharRelationships(characterId: string): Promise<void> {
  await run("DELETE FROM char_relationships WHERE character_id=? OR other_id=?", [characterId, characterId]);
}

export async function putCharRelationship(
  characterId: string,
  otherId: string,
  affinity: number,
  notes: string
): Promise<void> {
  if (characterId === otherId) return;
  await run(
    `INSERT INTO char_relationships (id, character_id, other_id, affinity, notes, updated_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(character_id, other_id) DO UPDATE SET affinity=excluded.affinity, notes=excluded.notes, updated_at=excluded.updated_at`,
    [uid(), characterId, otherId, Math.max(-100, Math.min(100, Math.round(affinity))), notes, now()]
  );
}

/* ---------------- usage ---------------- */

export async function logUsage(u: {
  provider: string;
  model: string;
  feature: string;
  chatId?: string | null;
  /** full-price prompt tokens (cache reads/writes excluded) */
  inputTokens: number;
  /** cached prompt reads (provider-discounted) and cache writes (may carry a surcharge) */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens: number;
}): Promise<void> {
  await run(
    "INSERT INTO usage_log (ts, provider, model, feature, chat_id, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens) VALUES (?,?,?,?,?,?,?,?,?)",
    [now(), u.provider, u.model, u.feature, u.chatId ?? null, u.inputTokens, u.cacheReadTokens ?? 0, u.cacheWriteTokens ?? 0, u.outputTokens]
  );
}

export async function usageReport(sinceTs = 0) {
  // Cost is derived at query time from the current per-model prices (USD per 1M tokens),
  // matched on the provider name + model id strings the log stores — so prices apply
  // retroactively, and rows whose model has no prices (or was deleted) count as unpriced
  // (cost NULL), never as $0. Cache reads/writes bill at their own price, each falling
  // back to the full input price when unset.
  const FROM = `FROM usage_log u
    LEFT JOIN (
      SELECT p.name AS provider, m.model_id AS model, MAX(m.input_price) AS ip,
             MAX(m.cache_read_price) AS crp, MAX(m.cache_write_price) AS cwp, MAX(m.output_price) AS op
      FROM models m JOIN providers p ON p.id = m.provider_id
      GROUP BY p.name, m.model_id
    ) pr ON pr.provider = u.provider AND pr.model = u.model
    WHERE u.ts>=?`;
  const UNPRICED = `pr.ip IS NULL AND pr.crp IS NULL AND pr.cwp IS NULL AND pr.op IS NULL`;
  const COST = `SUM(CASE WHEN ${UNPRICED} THEN NULL
    ELSE (u.input_tokens*COALESCE(pr.ip,0) + u.cache_read_tokens*COALESCE(pr.crp,pr.ip,0)
          + u.cache_write_tokens*COALESCE(pr.cwp,pr.ip,0) + u.output_tokens*COALESCE(pr.op,0))/1e6 END) AS cost`;
  const SUMS = `SUM(u.input_tokens)+SUM(u.cache_write_tokens) AS input, SUM(u.cache_read_tokens) AS cached,
    SUM(u.output_tokens) AS output, COUNT(*) AS calls, ${COST}`;
  // Postgres can't use the output aliases in an ORDER BY expression — repeat the sums
  const VOLUME = `SUM(u.input_tokens)+SUM(u.cache_write_tokens)+SUM(u.cache_read_tokens)+SUM(u.output_tokens)`;
  const totals = (await get(
    `SELECT COALESCE(SUM(u.input_tokens)+SUM(u.cache_write_tokens),0) AS input, COALESCE(SUM(u.cache_read_tokens),0) AS cached,
       COALESCE(SUM(u.output_tokens),0) AS output, COUNT(*) AS calls, ${COST},
       COALESCE(SUM(CASE WHEN ${UNPRICED} THEN u.input_tokens+u.cache_read_tokens+u.cache_write_tokens+u.output_tokens ELSE 0 END),0) AS unpriced
     ${FROM}`,
    [sinceTs]
  ))!;
  const byFeature = await all(
    `SELECT u.feature AS feature, ${SUMS} ${FROM} GROUP BY u.feature ORDER BY ${VOLUME} DESC`,
    [sinceTs]
  );
  const byModel = await all(
    `SELECT u.provider AS provider, u.model AS model, ${SUMS} ${FROM} GROUP BY u.provider, u.model ORDER BY ${VOLUME} DESC`,
    [sinceTs]
  );
  // to_char renders in the session timezone (set to the server's at connect)
  const byDay = await all(
    `SELECT to_char(to_timestamp(u.ts/1000.0), 'YYYY-MM-DD') AS day, ${SUMS} ${FROM} GROUP BY day ORDER BY day`,
    [sinceTs]
  );
  return { totals, byFeature, byModel, byDay };
}

/* ---------------- assets ---------------- */

export async function registerAsset(id: string, filename: string, mime: string, size: number): Promise<void> {
  await run(
    "INSERT INTO assets (id, filename, mime, size, created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
    [id, filename, mime, size, now()]
  );
}

export async function getAsset(
  id: string
): Promise<{ id: string; filename: string; mime: string; size: number } | null> {
  const r = await get("SELECT * FROM assets WHERE id=?", [id]);
  return r ? { id: r.id, filename: r.filename, mime: r.mime, size: r.size } : null;
}

export async function listAssets(): Promise<{ id: string; size: number; createdAt: number }[]> {
  const rows = await all("SELECT id, size, created_at FROM assets");
  return rows.map((r) => ({ id: r.id, size: r.size, createdAt: r.created_at }));
}

export async function deleteAssets(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await run("DELETE FROM assets WHERE id = ANY(?)", [ids]);
}
