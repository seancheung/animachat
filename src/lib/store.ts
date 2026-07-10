import { getDb, now, uid } from "./db";
import type {
  Chat,
  Character,
  Checkpoint,
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

export function createModel(m: Pick<Model, "providerId" | "modelId" | "displayName" | "contextWindow" | "customBody">): Model {
  const id = uid();
  getDb()
    .prepare(
      "INSERT INTO models (id, provider_id, model_id, display_name, context_window, custom_body, created_at) VALUES (?,?,?,?,?,?,?)"
    )
    .run(id, m.providerId, m.modelId, m.displayName, m.contextWindow, m.customBody ? J.str(m.customBody) : null, now());
  return getModel(id)!;
}

export function updateModel(id: string, p: Partial<Model>) {
  const cur = getModel(id);
  if (!cur) return null;
  const m = { ...cur, ...p };
  getDb()
    .prepare("UPDATE models SET model_id=?, display_name=?, context_window=?, custom_body=? WHERE id=?")
    .run(m.modelId, m.displayName, m.contextWindow, m.customBody ? J.str(m.customBody) : null, id);
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
  personality: r.personality,
  greeting: r.greeting,
  exampleDialogue: r.example_dialogue,
  sprites: J.parse(r.sprites, {}),
  customExpressions: J.parse(r.custom_expressions, []),
  typingSfxAsset: r.typing_sfx_asset,
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
    personality: "",
    greeting: "",
    exampleDialogue: "",
    sprites: {},
    customExpressions: [],
    typingSfxAsset: null,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    ...existing,
    ...c,
  });
  getDb()
    .prepare(
      `INSERT INTO characters (id,name,avatar_asset,personality,greeting,example_dialogue,sprites,custom_expressions,typing_sfx_asset,created_at,updated_at)
       VALUES (@id,@name,@avatar,@personality,@greeting,@example,@sprites,@custom,@sfx,@created,@updated)
       ON CONFLICT(id) DO UPDATE SET name=@name, avatar_asset=@avatar, personality=@personality, greeting=@greeting,
         example_dialogue=@example, sprites=@sprites, custom_expressions=@custom, typing_sfx_asset=@sfx, updated_at=@updated`
    )
    .run({
      id: m.id,
      name: m.name,
      avatar: m.avatarAsset,
      personality: m.personality,
      greeting: m.greeting,
      example: m.exampleDialogue,
      sprites: J.str(m.sprites),
      custom: J.str(m.customExpressions),
      sfx: m.typingSfxAsset,
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
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    ...existing,
    ...p,
  });
  getDb()
    .prepare(
      `INSERT INTO personas (id,name,description,created_at,updated_at) VALUES (@id,@name,@description,@created,@updated)
       ON CONFLICT(id) DO UPDATE SET name=@name, description=@description, updated_at=@updated`
    )
    .run({ id: m.id, name: m.name, description: m.description, created: m.createdAt, updated: m.updatedAt });
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
  artworkAsset: r.artwork_asset,
  bgmAsset: r.bgm_asset,
  ambientAsset: r.ambient_asset,
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
    artworkAsset: null,
    bgmAsset: null,
    ambientAsset: null,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    ...existing,
    ...x,
  });
  getDb()
    .prepare(
      `INSERT INTO locations (id,name,description,artwork_asset,bgm_asset,ambient_asset,created_at,updated_at)
       VALUES (@id,@name,@description,@art,@bgm,@amb,@created,@updated)
       ON CONFLICT(id) DO UPDATE SET name=@name, description=@description, artwork_asset=@art, bgm_asset=@bgm, ambient_asset=@amb, updated_at=@updated`
    )
    .run({
      id: m.id,
      name: m.name,
      description: m.description,
      art: m.artworkAsset,
      bgm: m.bgmAsset,
      amb: m.ambientAsset,
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
  locationId: r.location_id,
  artworkAsset: r.artwork_asset,
  bgmAsset: r.bgm_asset,
  ambientAsset: r.ambient_asset,
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
    locationId: null,
    artworkAsset: null,
    bgmAsset: null,
    ambientAsset: null,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    ...existing,
    ...x,
  });
  getDb()
    .prepare(
      `INSERT INTO scenes (id,name,setup,location_id,artwork_asset,bgm_asset,ambient_asset,created_at,updated_at)
       VALUES (@id,@name,@setup,@loc,@art,@bgm,@amb,@created,@updated)
       ON CONFLICT(id) DO UPDATE SET name=@name, setup=@setup, location_id=@loc, artwork_asset=@art, bgm_asset=@bgm, ambient_asset=@amb, updated_at=@updated`
    )
    .run({
      id: m.id,
      name: m.name,
      setup: m.setup,
      loc: m.locationId,
      art: m.artworkAsset,
      bgm: m.bgmAsset,
      amb: m.ambientAsset,
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
  sceneIds: J.parse(r.scene_ids, []),
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
    sceneIds: [],
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    ...existing,
    ...x,
  });
  getDb()
    .prepare(
      `INSERT INTO stories (id,name,description,scene_ids,created_at,updated_at) VALUES (@id,@name,@description,@scenes,@created,@updated)
       ON CONFLICT(id) DO UPDATE SET name=@name, description=@description, scene_ids=@scenes, updated_at=@updated`
    )
    .run({
      id: m.id,
      name: m.name,
      description: m.description,
      scenes: J.str(m.sceneIds),
      created: m.createdAt,
      updated: m.updatedAt,
    });
  return getStory(m.id)!;
}

export function deleteStory(id: string) {
  getDb().prepare("DELETE FROM stories WHERE id=?").run(id);
}

/* ---------------- lorebooks ---------------- */

const lorebookFromRow = (r: Row): Lorebook => ({
  id: r.id,
  name: r.name,
  description: r.description,
  entries: J.parse(r.entries, []),
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
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    ...existing,
    ...x,
  });
  getDb()
    .prepare(
      `INSERT INTO lorebooks (id,name,description,entries,created_at,updated_at) VALUES (@id,@name,@description,@entries,@created,@updated)
       ON CONFLICT(id) DO UPDATE SET name=@name, description=@description, entries=@entries, updated_at=@updated`
    )
    .run({
      id: m.id,
      name: m.name,
      description: m.description,
      entries: J.str(m.entries),
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
  folder: r.folder,
  tags: J.parse(r.tags, []),
  storyId: r.story_id,
  sceneId: r.scene_id,
  locationId: r.location_id,
  lorebookIds: J.parse(r.lorebook_ids, []),
  characterIds: J.parse(r.character_ids, []),
  personaId: r.persona_id,
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
    folder: "",
    tags: [],
    storyId: null,
    sceneId: null,
    locationId: null,
    lorebookIds: [],
    characterIds: [],
    personaId: null,
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
      `INSERT INTO chats (id,title,folder,tags,story_id,scene_id,location_id,lorebook_ids,character_ids,persona_id,model_id,char_models,language,pov,narrator_enabled,overrides,created_at,updated_at)
       VALUES (@id,@title,@folder,@tags,@story,@scene,@loc,@lore,@chars,@persona,@model,@charModels,@language,@pov,@narrator,@overrides,@created,@updated)
       ON CONFLICT(id) DO UPDATE SET title=@title, folder=@folder, tags=@tags, story_id=@story, scene_id=@scene, location_id=@loc,
         lorebook_ids=@lore, character_ids=@chars, persona_id=@persona, model_id=@model, char_models=@charModels,
         language=@language, pov=@pov, narrator_enabled=@narrator, overrides=@overrides, updated_at=@updated`
    )
    .run({
      id: m.id,
      title: m.title,
      folder: m.folder,
      tags: J.str(m.tags),
      story: m.storyId,
      scene: m.sceneId,
      loc: m.locationId,
      lore: J.str(m.lorebookIds),
      chars: J.str(m.characterIds),
      persona: m.personaId,
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
  sceneEvent?: SceneEvent | null;
}): Message {
  const db = getDb();
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
  return getMessage(id)!;
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

/** Delete all messages after (and optionally including) the given position. */
export function truncateMessages(chatId: string, position: number, inclusive = false) {
  getDb()
    .prepare(`DELETE FROM messages WHERE chat_id=? AND position ${inclusive ? ">=" : ">"} ?`)
    .run(chatId, position);
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

/* ---------------- checkpoints ---------------- */

const checkpointFromRow = (r: Row): Checkpoint => ({
  id: r.id,
  chatId: r.chat_id,
  messageId: r.message_id,
  name: r.name,
  createdAt: r.created_at,
});

export function listCheckpoints(chatId: string): Checkpoint[] {
  return (
    getDb().prepare("SELECT * FROM checkpoints WHERE chat_id=? ORDER BY created_at DESC").all(chatId) as Row[]
  ).map(checkpointFromRow);
}

export function getCheckpoint(id: string): Checkpoint | null {
  const r = getDb().prepare("SELECT * FROM checkpoints WHERE id=?").get(id) as Row | undefined;
  return r ? checkpointFromRow(r) : null;
}

export function createCheckpoint(chatId: string, messageId: string, name: string): Checkpoint {
  const id = uid();
  getDb()
    .prepare("INSERT INTO checkpoints (id, chat_id, message_id, name, created_at) VALUES (?,?,?,?,?)")
    .run(id, chatId, messageId, name, now());
  return getCheckpoint(id)!;
}

export function deleteCheckpoint(id: string) {
  getDb().prepare("DELETE FROM checkpoints WHERE id=?").run(id);
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

export function putRelationship(characterId: string, personaId: string, affinity: number, notes: string) {
  getDb()
    .prepare(
      `INSERT INTO relationships (id, character_id, persona_id, affinity, notes, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(character_id, persona_id) DO UPDATE SET affinity=excluded.affinity, notes=excluded.notes, updated_at=excluded.updated_at`
    )
    .run(uid(), characterId, personaId, Math.max(-100, Math.min(100, Math.round(affinity))), notes, now());
}

/* ---------------- usage ---------------- */

export function logUsage(u: {
  provider: string;
  model: string;
  feature: string;
  chatId?: string | null;
  inputTokens: number;
  outputTokens: number;
}) {
  getDb()
    .prepare(
      "INSERT INTO usage_log (ts, provider, model, feature, chat_id, input_tokens, output_tokens) VALUES (?,?,?,?,?,?,?)"
    )
    .run(now(), u.provider, u.model, u.feature, u.chatId ?? null, u.inputTokens, u.outputTokens);
}

export function usageReport(sinceTs = 0) {
  const db = getDb();
  const totals = db
    .prepare(
      "SELECT COALESCE(SUM(input_tokens),0) AS input, COALESCE(SUM(output_tokens),0) AS output, COUNT(*) AS calls FROM usage_log WHERE ts>=?"
    )
    .get(sinceTs) as Row;
  const byFeature = db
    .prepare(
      "SELECT feature, SUM(input_tokens) AS input, SUM(output_tokens) AS output, COUNT(*) AS calls FROM usage_log WHERE ts>=? GROUP BY feature ORDER BY input+output DESC"
    )
    .all(sinceTs) as Row[];
  const byModel = db
    .prepare(
      "SELECT provider, model, SUM(input_tokens) AS input, SUM(output_tokens) AS output, COUNT(*) AS calls FROM usage_log WHERE ts>=? GROUP BY provider, model ORDER BY input+output DESC"
    )
    .all(sinceTs) as Row[];
  const byDay = db
    .prepare(
      `SELECT date(ts/1000, 'unixepoch') AS day, SUM(input_tokens) AS input, SUM(output_tokens) AS output
       FROM usage_log WHERE ts>=? GROUP BY day ORDER BY day`
    )
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
