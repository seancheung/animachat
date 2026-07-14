import { getDb, now, uid } from "./db";
import type {
  Chat,
  Character,
  CharRelationship,
  Fact,
  Lorebook,
  Location,
  Message,
  MessageVariant,
  Model,
  Persona,
  Provider,
  Relationship,
  Scene,
  SceneEvent,
  Settings,
  Story,
} from "./types";
import { DEFAULT_SETTINGS } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

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

export function getSettings(): Settings {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as Row[];
  const stored: Record<string, unknown> = {};
  for (const r of rows) stored[r.key] = J.parse(r.value, null);
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}

export function putSettings(patch: Partial<Settings>) {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  );
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) stmt.run(k, J.str(v));
  });
  tx();
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

export function listProviders(): Provider[] {
  return (getDb().prepare("SELECT * FROM providers ORDER BY created_at").all() as Row[]).map(providerFromRow);
}

export function getProvider(id: string): Provider | null {
  const r = getDb().prepare("SELECT * FROM providers WHERE id=?").get(id) as Row | undefined;
  return r ? providerFromRow(r) : null;
}

export function createProvider(p: Pick<Provider, "name" | "type" | "baseUrl" | "apiKey">): Provider {
  const row = { id: uid(), created_at: now(), ...p };
  getDb()
    .prepare("INSERT INTO providers (id, name, type, base_url, api_key, created_at) VALUES (?,?,?,?,?,?)")
    .run(row.id, p.name, p.type, p.baseUrl, p.apiKey, row.created_at);
  return getProvider(row.id)!;
}

export function updateProvider(id: string, p: Partial<Provider>) {
  const cur = getProvider(id);
  if (!cur) return null;
  const m = { ...cur, ...p };
  getDb()
    .prepare("UPDATE providers SET name=?, type=?, base_url=?, api_key=? WHERE id=?")
    .run(m.name, m.type, m.baseUrl, m.apiKey, id);
  return getProvider(id);
}

export function deleteProvider(id: string) {
  getDb().prepare("DELETE FROM providers WHERE id=?").run(id);
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

export function listModels(): Model[] {
  return (getDb().prepare("SELECT * FROM models ORDER BY created_at").all() as Row[]).map(modelFromRow);
}

export function getModel(id: string): Model | null {
  const r = getDb().prepare("SELECT * FROM models WHERE id=?").get(id) as Row | undefined;
  return r ? modelFromRow(r) : null;
}

export function createModel(
  m: Pick<
    Model,
    "providerId" | "modelId" | "displayName" | "contextWindow" | "inputPrice" | "cacheReadPrice" | "cacheWritePrice" | "outputPrice" | "customBody"
  >
): Model {
  const id = uid();
  getDb()
    .prepare(
      "INSERT INTO models (id, provider_id, model_id, display_name, context_window, input_price, cache_read_price, cache_write_price, output_price, custom_body, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    )
    .run(
      id, m.providerId, m.modelId, m.displayName, m.contextWindow,
      m.inputPrice ?? null, m.cacheReadPrice ?? null, m.cacheWritePrice ?? null, m.outputPrice ?? null,
      m.customBody ? J.str(m.customBody) : null, now()
    );
  return getModel(id)!;
}

export function updateModel(id: string, p: Partial<Model>) {
  const cur = getModel(id);
  if (!cur) return null;
  const m = { ...cur, ...p };
  getDb()
    .prepare(
      "UPDATE models SET model_id=?, display_name=?, context_window=?, input_price=?, cache_read_price=?, cache_write_price=?, output_price=?, custom_body=? WHERE id=?"
    )
    .run(
      m.modelId, m.displayName, m.contextWindow,
      m.inputPrice ?? null, m.cacheReadPrice ?? null, m.cacheWritePrice ?? null, m.outputPrice ?? null,
      m.customBody ? J.str(m.customBody) : null, id
    );
  return getModel(id);
}

export function deleteModel(id: string) {
  getDb().prepare("DELETE FROM models WHERE id=?").run(id);
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
  idleMotion: !!r.idle_motion,
  tags: J.parse(r.tags, []),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function listCharacters(): Character[] {
  return (getDb().prepare("SELECT * FROM characters ORDER BY name").all() as Row[]).map(characterFromRow);
}

export function getCharacter(id: string): Character | null {
  const r = getDb().prepare("SELECT * FROM characters WHERE id=?").get(id) as Row | undefined;
  return r ? characterFromRow(r) : null;
}

export function saveCharacter(c: Partial<Character> & { id?: string }): Character {
  const existing = c.id ? getCharacter(c.id) : null;
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
    idleMotion: true,
    tags: [],
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    ...existing,
    ...c,
  });
  getDb()
    .prepare(
      `INSERT INTO characters (id,name,avatar_asset,description,greeting,example_dialogue,image_prompt,sprites,sprite_sfx,custom_expressions,typing_sfx_asset,track_relationship,idle_motion,tags,created_at,updated_at)
       VALUES (@id,@name,@avatar,@description,@greeting,@example,@imagePrompt,@sprites,@spriteSfx,@custom,@sfx,@trackRel,@idle,@tags,@created,@updated)
       ON CONFLICT(id) DO UPDATE SET name=@name, avatar_asset=@avatar, description=@description, greeting=@greeting,
         example_dialogue=@example, image_prompt=@imagePrompt, sprites=@sprites, sprite_sfx=@spriteSfx, custom_expressions=@custom, typing_sfx_asset=@sfx,
         track_relationship=@trackRel, idle_motion=@idle, tags=@tags, updated_at=@updated`
    )
    .run({
      id: m.id,
      name: m.name,
      avatar: m.avatarAsset,
      description: m.description,
      greeting: m.greeting,
      example: m.exampleDialogue,
      imagePrompt: m.imagePrompt,
      sprites: J.str(m.sprites),
      spriteSfx: J.str(m.spriteSfx),
      custom: J.str(m.customExpressions),
      sfx: m.typingSfxAsset,
      trackRel: m.trackRelationship ? 1 : 0,
      idle: m.idleMotion ? 1 : 0,
      tags: J.str(m.tags),
      created: m.createdAt,
      updated: m.updatedAt,
    });
  return getCharacter(m.id)!;
}

export function deleteCharacter(id: string) {
  getDb().prepare("DELETE FROM characters WHERE id=?").run(id);
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

export function listPersonas(): Persona[] {
  return (getDb().prepare("SELECT * FROM personas ORDER BY name").all() as Row[]).map(personaFromRow);
}

export function getPersona(id: string): Persona | null {
  const r = getDb().prepare("SELECT * FROM personas WHERE id=?").get(id) as Row | undefined;
  return r ? personaFromRow(r) : null;
}

export function savePersona(p: Partial<Persona> & { id?: string }): Persona {
  const existing = p.id ? getPersona(p.id) : null;
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
  getDb()
    .prepare(
      `INSERT INTO personas (id,name,description,tags,created_at,updated_at) VALUES (@id,@name,@description,@tags,@created,@updated)
       ON CONFLICT(id) DO UPDATE SET name=@name, description=@description, tags=@tags, updated_at=@updated`
    )
    .run({ id: m.id, name: m.name, description: m.description, tags: J.str(m.tags), created: m.createdAt, updated: m.updatedAt });
  return getPersona(m.id)!;
}

export function deletePersona(id: string) {
  getDb().prepare("DELETE FROM personas WHERE id=?").run(id);
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

export function listLocations(): Location[] {
  return (getDb().prepare("SELECT * FROM locations ORDER BY name").all() as Row[]).map(locationFromRow);
}

export function getLocation(id: string): Location | null {
  const r = getDb().prepare("SELECT * FROM locations WHERE id=?").get(id) as Row | undefined;
  return r ? locationFromRow(r) : null;
}

export function saveLocation(x: Partial<Location> & { id?: string }): Location {
  const existing = x.id ? getLocation(x.id) : null;
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
  getDb()
    .prepare(
      `INSERT INTO locations (id,name,description,image_prompt,artwork_asset,bgm_asset,ambient_asset,stage_style,tags,created_at,updated_at)
       VALUES (@id,@name,@description,@imagePrompt,@art,@bgm,@amb,@style,@tags,@created,@updated)
       ON CONFLICT(id) DO UPDATE SET name=@name, description=@description, image_prompt=@imagePrompt, artwork_asset=@art, bgm_asset=@bgm, ambient_asset=@amb, stage_style=@style, tags=@tags, updated_at=@updated`
    )
    .run({
      id: m.id,
      name: m.name,
      description: m.description,
      imagePrompt: m.imagePrompt,
      art: m.artworkAsset,
      bgm: m.bgmAsset,
      amb: m.ambientAsset,
      style: m.stageStyle ? JSON.stringify(m.stageStyle) : null,
      tags: J.str(m.tags),
      created: m.createdAt,
      updated: m.updatedAt,
    });
  return getLocation(m.id)!;
}

export function deleteLocation(id: string) {
  getDb().prepare("DELETE FROM locations WHERE id=?").run(id);
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

export function listScenes(): Scene[] {
  return (getDb().prepare("SELECT * FROM scenes ORDER BY name").all() as Row[]).map(sceneFromRow);
}

export function getScene(id: string): Scene | null {
  const r = getDb().prepare("SELECT * FROM scenes WHERE id=?").get(id) as Row | undefined;
  return r ? sceneFromRow(r) : null;
}

export function saveScene(x: Partial<Scene> & { id?: string }): Scene {
  const existing = x.id ? getScene(x.id) : null;
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
  getDb()
    .prepare(
      `INSERT INTO scenes (id,name,setup,image_prompt,location_id,artwork_asset,bgm_asset,ambient_asset,stage_style,tags,created_at,updated_at)
       VALUES (@id,@name,@setup,@imagePrompt,@loc,@art,@bgm,@amb,@style,@tags,@created,@updated)
       ON CONFLICT(id) DO UPDATE SET name=@name, setup=@setup, image_prompt=@imagePrompt, location_id=@loc, artwork_asset=@art, bgm_asset=@bgm, ambient_asset=@amb, stage_style=@style, tags=@tags, updated_at=@updated`
    )
    .run({
      id: m.id,
      name: m.name,
      setup: m.setup,
      imagePrompt: m.imagePrompt,
      loc: m.locationId,
      art: m.artworkAsset,
      bgm: m.bgmAsset,
      amb: m.ambientAsset,
      style: m.stageStyle ? JSON.stringify(m.stageStyle) : null,
      tags: J.str(m.tags),
      created: m.createdAt,
      updated: m.updatedAt,
    });
  return getScene(m.id)!;
}

export function deleteScene(id: string) {
  getDb().prepare("DELETE FROM scenes WHERE id=?").run(id);
}

/* ---------------- stories ---------------- */

const storyFromRow = (r: Row): Story => ({
  id: r.id,
  name: r.name,
  description: r.description,
  characterIds: J.parse(r.character_ids, []),
  scenes: J.parse(r.scenes, []),
  lorebookIds: J.parse(r.lorebook_ids, []),
  tags: J.parse(r.tags, []),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function listStories(): Story[] {
  return (getDb().prepare("SELECT * FROM stories ORDER BY name").all() as Row[]).map(storyFromRow);
}

export function getStory(id: string): Story | null {
  const r = getDb().prepare("SELECT * FROM stories WHERE id=?").get(id) as Row | undefined;
  return r ? storyFromRow(r) : null;
}

export function saveStory(x: Partial<Story> & { id?: string }): Story {
  const existing = x.id ? getStory(x.id) : null;
  const m: Story = touch({
    id: existing?.id ?? x.id ?? uid(),
    name: "Untitled story",
    description: "",
    characterIds: [],
    scenes: [],
    lorebookIds: [],
    tags: [],
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    ...existing,
    ...x,
  });
  getDb()
    .prepare(
      `INSERT INTO stories (id,name,description,character_ids,scenes,lorebook_ids,tags,created_at,updated_at)
       VALUES (@id,@name,@description,@chars,@scenes,@lore,@tags,@created,@updated)
       ON CONFLICT(id) DO UPDATE SET name=@name, description=@description, character_ids=@chars, scenes=@scenes, lorebook_ids=@lore, tags=@tags, updated_at=@updated`
    )
    .run({
      id: m.id,
      name: m.name,
      description: m.description,
      chars: J.str(m.characterIds),
      scenes: J.str(m.scenes),
      lore: J.str(m.lorebookIds),
      tags: J.str(m.tags),
      created: m.createdAt,
      updated: m.updatedAt,
    });
  return getStory(m.id)!;
}

export function deleteStory(id: string) {
  getDb().prepare("DELETE FROM stories WHERE id=?").run(id);
}

/* ---------------- library integrity ---------------- */

/**
 * What still references this library item — a non-empty result blocks deletion.
 * Chain: location ← scene ← story; character/lorebook ← story. Chats never block:
 * playthroughs are self-contained snapshots, casual/immersive chats degrade fail-soft.
 */
export function libraryReferences(
  type: "character" | "scene" | "location" | "lorebook",
  id: string
): string[] {
  const refs: string[] = [];
  if (type === "location") {
    for (const s of listScenes()) if (s.locationId === id) refs.push(`scene "${s.name}"`);
  }
  for (const st of listStories()) {
    const inStory =
      (type === "character" && st.characterIds.includes(id)) ||
      (type === "scene" && st.scenes.some((s) => s.sceneId === id)) ||
      (type === "lorebook" && st.lorebookIds.includes(id));
    if (inStory) refs.push(`story "${st.name}"`);
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

export function listLorebooks(): Lorebook[] {
  return (getDb().prepare("SELECT * FROM lorebooks ORDER BY name").all() as Row[]).map(lorebookFromRow);
}

export function getLorebook(id: string): Lorebook | null {
  const r = getDb().prepare("SELECT * FROM lorebooks WHERE id=?").get(id) as Row | undefined;
  return r ? lorebookFromRow(r) : null;
}

export function saveLorebook(x: Partial<Lorebook> & { id?: string }): Lorebook {
  const existing = x.id ? getLorebook(x.id) : null;
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
  getDb()
    .prepare(
      `INSERT INTO lorebooks (id,name,description,entries,tags,created_at,updated_at) VALUES (@id,@name,@description,@entries,@tags,@created,@updated)
       ON CONFLICT(id) DO UPDATE SET name=@name, description=@description, entries=@entries, tags=@tags, updated_at=@updated`
    )
    .run({
      id: m.id,
      name: m.name,
      description: m.description,
      entries: J.str(m.entries),
      tags: J.str(m.tags),
      created: m.createdAt,
      updated: m.updatedAt,
    });
  return getLorebook(m.id)!;
}

export function deleteLorebook(id: string) {
  getDb().prepare("DELETE FROM lorebooks WHERE id=?").run(id);
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
  overrides: J.parse(r.overrides, {}),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function listChats(): Chat[] {
  return (getDb().prepare("SELECT * FROM chats ORDER BY updated_at DESC").all() as Row[]).map(chatFromRow);
}

export function getChat(id: string): Chat | null {
  const r = getDb().prepare("SELECT * FROM chats WHERE id=?").get(id) as Row | undefined;
  return r ? chatFromRow(r) : null;
}

export function saveChat(x: Partial<Chat> & { id?: string }): Chat {
  const existing = x.id ? getChat(x.id) : null;
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
    overrides: {},
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    ...existing,
    ...x,
  });
  getDb()
    .prepare(
      `INSERT INTO chats (id,title,mode,folder,tags,story_id,scene_id,location_id,lorebook_ids,character_ids,persona_id,persona_character_id,story_snapshot,name_snapshots,model_id,char_models,language,pov,narrator_enabled,overrides,created_at,updated_at)
       VALUES (@id,@title,@mode,@folder,@tags,@story,@scene,@loc,@lore,@chars,@persona,@personaChar,@snapshot,@names,@model,@charModels,@language,@pov,@narrator,@overrides,@created,@updated)
       ON CONFLICT(id) DO UPDATE SET title=@title, mode=@mode, folder=@folder, tags=@tags, story_id=@story, scene_id=@scene, location_id=@loc,
         lorebook_ids=@lore, character_ids=@chars, persona_id=@persona, persona_character_id=@personaChar, story_snapshot=@snapshot,
         name_snapshots=@names, model_id=@model, char_models=@charModels,
         language=@language, pov=@pov, narrator_enabled=@narrator, overrides=@overrides, updated_at=@updated`
    )
    .run({
      id: m.id,
      title: m.title,
      mode: m.mode,
      folder: m.folder,
      tags: J.str(m.tags),
      story: m.storyId,
      scene: m.sceneId,
      loc: m.locationId,
      lore: J.str(m.lorebookIds),
      chars: J.str(m.characterIds),
      persona: m.personaId,
      personaChar: m.personaCharacterId,
      snapshot: m.storySnapshot ? J.str(m.storySnapshot) : null,
      names: J.str(m.nameSnapshots),
      model: m.modelId,
      charModels: J.str(m.charModels),
      language: m.language,
      pov: m.pov,
      narrator: m.narratorEnabled ? 1 : 0,
      overrides: J.str(m.overrides),
      created: m.createdAt,
      updated: m.updatedAt,
    });
  return getChat(m.id)!;
}

export function deleteChat(id: string) {
  getDb().prepare("DELETE FROM chats WHERE id=?").run(id);
}

export function touchChat(id: string) {
  getDb().prepare("UPDATE chats SET updated_at=? WHERE id=?").run(now(), id);
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

export function listMessages(chatId: string): Message[] {
  return (
    getDb().prepare("SELECT * FROM messages WHERE chat_id=? ORDER BY position").all(chatId) as Row[]
  ).map(messageFromRow);
}

export function getMessage(id: string): Message | null {
  const r = getDb().prepare("SELECT * FROM messages WHERE id=?").get(id) as Row | undefined;
  return r ? messageFromRow(r) : null;
}

function searchTextOf(variants: MessageVariant[]): string {
  return variants.map((v) => v.content).join("\n");
}

export function appendMessage(m: {
  chatId: string;
  role: Message["role"];
  characterId?: string | null;
  content: string;
  emotion?: string | null;
  options?: string[] | null;
  /** raw model output before tag parsing (AI messages only) */
  raw?: string | null;
  sceneEvent?: SceneEvent | null;
}): Message {
  const db = getDb();
  // freeze the previous tail: alternatives (swipes) live on the newest message only —
  // once a follow-up lands, the chosen variant is the message and the others are dropped
  const prevRow = db
    .prepare("SELECT * FROM messages WHERE chat_id=? ORDER BY position DESC LIMIT 1")
    .get(m.chatId) as Row | undefined;
  if (prevRow) {
    const prev = messageFromRow(prevRow);
    if (prev.variants.length > 1) {
      const keptIndex = prev.variants[prev.activeVariant] ? prev.activeVariant : 0;
      updateMessage(prev.id, { variants: [prev.variants[keptIndex]], activeVariant: 0 });
      // raw outputs follow their variants: keep only the chosen one, re-keyed to 0
      db.prepare("DELETE FROM raw_outputs WHERE message_id=? AND variant_index<>?").run(prev.id, keptIndex);
      db.prepare("UPDATE raw_outputs SET variant_index=0 WHERE message_id=?").run(prev.id);
    }
  }
  const pos =
    ((db.prepare("SELECT MAX(position) AS p FROM messages WHERE chat_id=?").get(m.chatId) as Row)?.p ?? -1) + 1;
  const variant: MessageVariant = {
    content: m.content,
    emotion: m.emotion ?? null,
    options: m.options ?? null,
    createdAt: now(),
  };
  const id = uid();
  db.prepare(
    `INSERT INTO messages (id, chat_id, position, role, character_id, variants, active_variant, scene_event, search_text, created_at)
     VALUES (?,?,?,?,?,?,0,?,?,?)`
  ).run(
    id,
    m.chatId,
    pos,
    m.role,
    m.characterId ?? null,
    J.str([variant]),
    m.sceneEvent ? J.str(m.sceneEvent) : null,
    searchTextOf([variant]),
    now()
  );
  touchChat(m.chatId);
  if (m.raw != null) setRawOutput(id, 0, m.raw);
  return getMessage(id)!;
}

/** Attach a model's raw pre-parse output to a message variant. Debugging data,
 *  database-only: never read by the app, never sent to clients, forks or archives. */
export function setRawOutput(messageId: string, variantIndex: number, raw: string) {
  getDb()
    .prepare("INSERT OR REPLACE INTO raw_outputs (message_id, variant_index, raw) VALUES (?,?,?)")
    .run(messageId, variantIndex, raw);
}

export function updateMessage(
  id: string,
  patch: {
    variants?: MessageVariant[];
    activeVariant?: number;
    sceneEvent?: SceneEvent | null;
  }
): Message | null {
  const cur = getMessage(id);
  if (!cur) return null;
  const variants = patch.variants ?? cur.variants;
  const active = Math.min(patch.activeVariant ?? cur.activeVariant, Math.max(0, variants.length - 1));
  const sceneEvent = patch.sceneEvent === undefined ? cur.sceneEvent : patch.sceneEvent;
  getDb()
    .prepare("UPDATE messages SET variants=?, active_variant=?, scene_event=?, search_text=? WHERE id=?")
    .run(J.str(variants), active, sceneEvent ? J.str(sceneEvent) : null, searchTextOf(variants), id);
  return getMessage(id);
}

export function deleteMessage(id: string) {
  getDb().prepare("DELETE FROM messages WHERE id=?").run(id);
}

export function searchMessages(q: string, limit = 50): { message: Message; chat: Chat }[] {
  const rows = getDb()
    .prepare(
      `SELECT m.* FROM messages m JOIN chats c ON c.id = m.chat_id
       WHERE m.search_text LIKE ? ESCAPE '\\' ORDER BY m.created_at DESC LIMIT ?`
    )
    .all(`%${q.replace(/[%_\\]/g, (ch) => "\\" + ch)}%`, limit) as Row[];
  const out: { message: Message; chat: Chat }[] = [];
  for (const r of rows) {
    const chat = getChat(r.chat_id);
    if (chat) out.push({ message: messageFromRow(r), chat });
  }
  return out;
}

/* ---------------- memory: summaries, facts, relationships ---------------- */

export function getSummary(chatId: string): { content: string; coveredPosition: number } {
  const r = getDb().prepare("SELECT * FROM summaries WHERE chat_id=?").get(chatId) as Row | undefined;
  return r ? { content: r.content, coveredPosition: r.covered_position } : { content: "", coveredPosition: -1 };
}

export function putSummary(chatId: string, content: string, coveredPosition: number) {
  getDb()
    .prepare(
      `INSERT INTO summaries (chat_id, content, covered_position, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(chat_id) DO UPDATE SET content=excluded.content, covered_position=excluded.covered_position, updated_at=excluded.updated_at`
    )
    .run(chatId, content, coveredPosition, now());
}

/** Invalidate summary coverage from a position onward (edit/rewind touching summarized range). */
export function invalidateSummary(chatId: string, fromPosition: number) {
  const s = getSummary(chatId);
  if (s.coveredPosition >= fromPosition) {
    // Drop the whole summary: chunks are merged, so partial rollback is impossible.
    getDb().prepare("DELETE FROM summaries WHERE chat_id=?").run(chatId);
  }
}

const factFromRow = (r: Row): Fact => ({
  id: r.id,
  characterId: r.character_id,
  chatId: r.chat_id,
  content: r.content,
  createdAt: r.created_at,
});

export function listFacts(characterId: string, limit = 100): Fact[] {
  return (
    getDb()
      .prepare("SELECT * FROM facts WHERE character_id=? ORDER BY created_at DESC LIMIT ?")
      .all(characterId, limit) as Row[]
  ).map(factFromRow);
}

export function addFact(characterId: string, chatId: string | null, content: string): Fact {
  const id = uid();
  getDb()
    .prepare("INSERT INTO facts (id, character_id, chat_id, content, created_at) VALUES (?,?,?,?,?)")
    .run(id, characterId, chatId, content, now());
  return factFromRow(getDb().prepare("SELECT * FROM facts WHERE id=?").get(id) as Row);
}

export function deleteFact(id: string) {
  getDb().prepare("DELETE FROM facts WHERE id=?").run(id);
}

const relationshipFromRow = (r: Row): Relationship => ({
  id: r.id,
  characterId: r.character_id,
  personaId: r.persona_id,
  affinity: r.affinity,
  notes: r.notes,
  updatedAt: r.updated_at,
});

export function getRelationship(characterId: string, personaId: string): Relationship | null {
  const r = getDb()
    .prepare("SELECT * FROM relationships WHERE character_id=? AND persona_id=?")
    .get(characterId, personaId) as Row | undefined;
  return r ? relationshipFromRow(r) : null;
}

export function listRelationships(characterId: string): Relationship[] {
  return (
    getDb().prepare("SELECT * FROM relationships WHERE character_id=?").all(characterId) as Row[]
  ).map(relationshipFromRow);
}

/** Reset: forget all relationship data for a character (all personas). */
export function deleteRelationships(characterId: string) {
  getDb().prepare("DELETE FROM relationships WHERE character_id=?").run(characterId);
}

export function putRelationship(characterId: string, personaId: string, affinity: number, notes: string) {
  getDb()
    .prepare(
      `INSERT INTO relationships (id, character_id, persona_id, affinity, notes, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(character_id, persona_id) DO UPDATE SET affinity=excluded.affinity, notes=excluded.notes, updated_at=excluded.updated_at`
    )
    .run(uid(), characterId, personaId, Math.max(-100, Math.min(100, Math.round(affinity))), notes, now());
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

export function getCharRelationship(characterId: string, otherId: string): CharRelationship | null {
  const r = getDb()
    .prepare("SELECT * FROM char_relationships WHERE character_id=? AND other_id=?")
    .get(characterId, otherId) as Row | undefined;
  return r ? charRelationshipFromRow(r) : null;
}

export function listCharRelationships(characterId: string): CharRelationship[] {
  return (
    getDb().prepare("SELECT * FROM char_relationships WHERE character_id=?").all(characterId) as Row[]
  ).map(charRelationshipFromRow);
}

/** Reset: forget a character's views of others AND others' views of them. */
export function deleteCharRelationships(characterId: string) {
  getDb()
    .prepare("DELETE FROM char_relationships WHERE character_id=? OR other_id=?")
    .run(characterId, characterId);
}

export function putCharRelationship(characterId: string, otherId: string, affinity: number, notes: string) {
  if (characterId === otherId) return;
  getDb()
    .prepare(
      `INSERT INTO char_relationships (id, character_id, other_id, affinity, notes, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(character_id, other_id) DO UPDATE SET affinity=excluded.affinity, notes=excluded.notes, updated_at=excluded.updated_at`
    )
    .run(uid(), characterId, otherId, Math.max(-100, Math.min(100, Math.round(affinity))), notes, now());
}

/* ---------------- usage ---------------- */

export function logUsage(u: {
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
}) {
  getDb()
    .prepare(
      "INSERT INTO usage_log (ts, provider, model, feature, chat_id, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens) VALUES (?,?,?,?,?,?,?,?,?)"
    )
    .run(now(), u.provider, u.model, u.feature, u.chatId ?? null, u.inputTokens, u.cacheReadTokens ?? 0, u.cacheWriteTokens ?? 0, u.outputTokens);
}

export function usageReport(sinceTs = 0) {
  const db = getDb();
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
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(u.input_tokens)+SUM(u.cache_write_tokens),0) AS input, COALESCE(SUM(u.cache_read_tokens),0) AS cached,
         COALESCE(SUM(u.output_tokens),0) AS output, COUNT(*) AS calls, ${COST},
         COALESCE(SUM(CASE WHEN ${UNPRICED} THEN u.input_tokens+u.cache_read_tokens+u.cache_write_tokens+u.output_tokens ELSE 0 END),0) AS unpriced
       ${FROM}`
    )
    .get(sinceTs) as Row;
  const byFeature = db
    .prepare(`SELECT u.feature AS feature, ${SUMS} ${FROM} GROUP BY u.feature ORDER BY input+cached+output DESC`)
    .all(sinceTs) as Row[];
  const byModel = db
    .prepare(
      `SELECT u.provider AS provider, u.model AS model, ${SUMS} ${FROM} GROUP BY u.provider, u.model ORDER BY input+cached+output DESC`
    )
    .all(sinceTs) as Row[];
  const byDay = db
    .prepare(`SELECT date(u.ts/1000, 'unixepoch') AS day, ${SUMS} ${FROM} GROUP BY day ORDER BY day`)
    .all(sinceTs) as Row[];
  return { totals, byFeature, byModel, byDay };
}

/* ---------------- assets ---------------- */

export function registerAsset(id: string, filename: string, mime: string, size: number) {
  getDb()
    .prepare(
      "INSERT INTO assets (id, filename, mime, size, created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING"
    )
    .run(id, filename, mime, size, now());
}

export function getAsset(id: string): { id: string; filename: string; mime: string; size: number } | null {
  const r = getDb().prepare("SELECT * FROM assets WHERE id=?").get(id) as Row | undefined;
  return r ? { id: r.id, filename: r.filename, mime: r.mime, size: r.size } : null;
}

export function listAssets(): { id: string; size: number }[] {
  const rows = getDb().prepare("SELECT id, size FROM assets").all() as Row[];
  return rows.map((r) => ({ id: r.id, size: r.size }));
}

export function deleteAssets(ids: string[]) {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM assets WHERE id=?");
  db.transaction((list: string[]) => {
    for (const id of list) stmt.run(id);
  })(ids);
}
