import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Each test file gets a throwaway Postgres schema — the store opens its
// connection lazily on first query, so setting the env here is safe. The app
// runs no DDL, so beforeAll applies migrations/*.sql into the schema; afterAll
// drops it. DATABASE_URL must point at a reachable Postgres (the
// docker-compose one by default).
const TEST_SCHEMA = `test_store_${process.pid.toString(36)}_${Date.now().toString(36)}`;
process.env.ANIMACHAT_PG_SCHEMA = TEST_SCHEMA;
import fs from "node:fs";
import path from "node:path";
import { dropTestSchema, initTestSchema } from "./testDb";
import { all, execRaw, get, run } from "./db";
import { normalizeStoryDoc } from "./storyDoc";
import {
  PageError,
  addFact,
  addVariant,
  appendMessage,
  assetStats,
  decodeCursor,
  deleteChat,
  deleteCharacter,
  deleteStory,
  encodeCursor,
  getCharacter,
  getDirectorRead,
  getMessage,
  getSettings,
  getStoryBonds,
  listChatFolders,
  listDistinctTags,
  listReferencedAssetIds,
  listStoryBonds,
  pageCharacters,
  pageChats,
  pageFacts,
  pageMessages,
  putDirectorRead,
  putSettings,
  putStoryBonds,
  resetSettings,
  saveChat,
  saveCharacter,
  registerAsset,
  savePersona,
  saveScene,
  saveStory,
  searchLibraryNames,
  updateMessage,
} from "./store";

beforeAll(() => initTestSchema(TEST_SCHEMA));
afterAll(() => dropTestSchema(TEST_SCHEMA));

describe("resetSettings", () => {
  it("clears every stored setting back to the defaults", async () => {
    await putSettings({ language: "French", typingSpeed: 90, taskMaxTokens: { chat: 2500 } });
    expect((await getSettings()).language).toBe("French");
    await resetSettings();
    const s = await getSettings();
    expect(s.language).toBe("English");
    expect(s.typingSpeed).toBe(60);
    expect(s.taskMaxTokens).toEqual({});
  });
});

describe("appendMessage tail freeze", () => {
  it("collapses the previous tail's variants to the active one when a follow-up lands", async () => {
    const chat = await saveChat({ title: "freeze" });
    const first = await appendMessage({ chatId: chat.id, role: "character", content: "take one" });
    await updateMessage(first.id, {
      variants: [...first.variants, { content: "take two", emotion: "smug", options: null, createdAt: 1 }],
      activeVariant: 1,
    });

    await appendMessage({ chatId: chat.id, role: "user", content: "reply" });

    const frozen = (await getMessage(first.id))!;
    expect(frozen.variants).toHaveLength(1);
    expect(frozen.variants[0].content).toBe("take two"); // the chosen variant survives
    expect(frozen.activeVariant).toBe(0);
  });

  it("leaves the new tail's own variants intact", async () => {
    const chat = await saveChat({ title: "freeze2" });
    await appendMessage({ chatId: chat.id, role: "user", content: "hi" });
    const tail = await appendMessage({ chatId: chat.id, role: "character", content: "a" });
    await updateMessage(tail.id, {
      variants: [...tail.variants, { content: "b", emotion: null, options: null, createdAt: 1 }],
      activeVariant: 1,
    });
    expect((await getMessage(tail.id))!.variants).toHaveLength(2);
  });
});

describe("updateMessage activeVariant clamp", () => {
  it("rejects negative and fractional indexes (they would poison pageChats' JSON path)", async () => {
    const chat = await saveChat({ title: "clamp" });
    const m = await appendMessage({ chatId: chat.id, role: "character", content: "only" });
    expect((await updateMessage(m.id, { activeVariant: -1 }))!.activeVariant).toBe(0);
    expect((await updateMessage(m.id, { activeVariant: 0.5 }))!.activeVariant).toBe(0);
    expect((await updateMessage(m.id, { activeVariant: 99 }))!.activeVariant).toBe(0);
  });
});

describe("addVariant", () => {
  it("appends a swipe to the tail and re-reads fresh variants", async () => {
    const chat = await saveChat({ title: "regen" });
    await appendMessage({ chatId: chat.id, role: "user", content: "hi" });
    const tail = await appendMessage({ chatId: chat.id, role: "character", content: "take one" });
    const saved = await addVariant(tail.id, { content: "take two", emotion: null, options: null, createdAt: 1 });
    expect(saved!.variants.map((v) => v.content)).toEqual(["take one", "take two"]);
    expect(saved!.activeVariant).toBe(1);
  });

  it("refuses a message that is no longer the tail (regen raced a new message)", async () => {
    const chat = await saveChat({ title: "regen race" });
    const target = await appendMessage({ chatId: chat.id, role: "character", content: "old tail" });
    await appendMessage({ chatId: chat.id, role: "user", content: "moved on" });
    const saved = await addVariant(target.id, { content: "late regen", emotion: null, options: null, createdAt: 1 });
    expect(saved).toBeNull();
    expect((await getMessage(target.id))!.variants).toHaveLength(1);
  });
});

describe("per-variant sceneEvent", () => {
  it("swiping switches the message's stage event to the active variant's", async () => {
    const chat = await saveChat({ title: "per-variant events" });
    await appendMessage({ chatId: chat.id, role: "user", content: "hi" });
    const tail = await appendMessage({
      chatId: chat.id,
      role: "narrator",
      content: "v1 ends it",
      sceneEvent: { theEnd: true },
    });
    const saved = (await addVariant(tail.id, {
      content: "v2 keeps going",
      emotion: null,
      options: null,
      sceneEvent: null,
      createdAt: 1,
    }))!;
    expect(saved.sceneEvent).toBeNull(); // the regen carried no stage tags
    expect((await updateMessage(tail.id, { activeVariant: 0 }))!.sceneEvent).toEqual({ theEnd: true });
    expect((await updateMessage(tail.id, { activeVariant: 1 }))!.sceneEvent).toBeNull();
  });

  it("variants from before events lived on them keep the message-level event", async () => {
    const chat = await saveChat({ title: "legacy variants" });
    const m = await appendMessage({
      chatId: chat.id,
      role: "narrator",
      content: "old row",
      sceneEvent: { theEnd: true },
    });
    // simulate a pre-field row: variant without the sceneEvent key
    await updateMessage(m.id, { variants: [{ content: "old row", emotion: null, options: null, createdAt: 1 }] });
    expect((await getMessage(m.id))!.sceneEvent).toEqual({ theEnd: true });
  });

  it("an explicit sceneEvent edit is mirrored onto the active variant", async () => {
    const chat = await saveChat({ title: "event edit" });
    await appendMessage({ chatId: chat.id, role: "user", content: "hi" });
    const tail = await appendMessage({ chatId: chat.id, role: "narrator", content: "v1", sceneEvent: null });
    await addVariant(tail.id, { content: "v2", emotion: null, options: null, sceneEvent: null, createdAt: 1 });
    await updateMessage(tail.id, { sceneEvent: { theEnd: true } }); // edit while v2 is active
    await updateMessage(tail.id, { activeVariant: 0 });
    const back = (await updateMessage(tail.id, { activeVariant: 1 }))!; // swipe away and back
    expect(back.sceneEvent).toEqual({ theEnd: true });
  });
});

describe("pageMessages", () => {
  it("walks the whole timeline newest-first in keyset pages, without gaps or repeats", async () => {
    const chat = await saveChat({ title: "paging" });
    for (let i = 0; i < 7; i++) await appendMessage({ chatId: chat.id, role: "user", content: `m${i}` });

    const p1 = await pageMessages(chat.id, { limit: 3 });
    expect(p1.items.map((m) => m.variants[0].content)).toEqual(["m6", "m5", "m4"]);
    const p2 = await pageMessages(chat.id, { limit: 3, cursor: p1.nextCursor });
    expect(p2.items.map((m) => m.variants[0].content)).toEqual(["m3", "m2", "m1"]);
    const p3 = await pageMessages(chat.id, { limit: 3, cursor: p2.nextCursor });
    expect(p3.items.map((m) => m.variants[0].content)).toEqual(["m0"]);
    expect(p3.nextCursor).toBeNull();
  });

  it("has no next page when the last page is exactly full", async () => {
    const chat = await saveChat({ title: "paging exact" });
    await appendMessage({ chatId: chat.id, role: "user", content: "a" });
    await appendMessage({ chatId: chat.id, role: "user", content: "b" });
    const p = await pageMessages(chat.id, { limit: 2 });
    expect(p.items).toHaveLength(2);
    expect(p.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor", async () => {
    const chat = await saveChat({ title: "paging cursor" });
    await expect(pageMessages(chat.id, { cursor: "garbage" })).rejects.toThrow(PageError);
    await expect(pageMessages(chat.id, { cursor: encodeCursor({ v: "not-a-position" }) })).rejects.toThrow(
      PageError
    );
  });
});

describe("saveStory (embedded document)", () => {
  it("normalizes embedded items and self-heals internal references", async () => {
    const story = await saveStory({
      name: "branches",
      // partial embedded items (missing contract fields, refs into and out of the
      // document) — the save fills defaults and prunes anything pointing outside
      characters: [{ id: "c1", name: "Mira" }],
      locations: [{ id: "l1", name: "Tavern" }],
      scenes: [
        { id: "a", name: "A", cast: ["c1", "ghost"], locationId: "l1" },
        {
          id: "b",
          name: "B",
          locationId: "not-a-location",
          successors: [
            { sceneId: "b", hint: "self" },
            { sceneId: "not-in-story", hint: "dangling" },
            { sceneId: "a", hint: "back to the start" },
          ],
        },
      ],
      secrets: [{ title: "s", content: "t", knownBy: ["c1", "ghost"], revealHint: "" }],
    } as never);
    expect(story.scenes[0]).toMatchObject({
      goal: "",
      obstacles: "",
      exit: "",
      pressures: "",
      successors: [],
      cast: ["c1"], // the ghost cast member is pruned
      locationId: "l1",
    });
    expect(story.scenes[1].locationId).toBeNull(); // unknown location dropped
    expect(story.scenes[1].successors).toEqual([{ sceneId: "a", hint: "back to the start" }]);
    expect(story.secrets[0].knownBy).toEqual(["c1"]);
    expect(story.characters[0]).toMatchObject({ name: "Mira", trackRelationship: true });
    expect(story.characters[0].innerSelf).toBe(""); // sparse-safe: missing key normalizes to empty
  });

  it("preserves an embedded character's innerSelf through normalization", async () => {
    const story = await saveStory({
      name: "inner",
      characters: [{ id: "c1", name: "Mira", innerSelf: "hides warmth behind sarcasm" }],
    } as never);
    expect(story.characters[0].innerSelf).toBe("hides warmth behind sarcasm");
  });
});

describe("inner self (column round-trip & seed backfill)", () => {
  const MIRA_ID = "d29d05fd-1ada-40fc-893b-c0c444136140";
  const STORY_ID = "11872c33-a24f-49dd-a702-6718d23fe3ab";
  // the pre-split seed description, byte-for-byte (real apostrophes and em-dashes)
  const MIRA_OLD =
    "[char_name] Thistledown, 24, alchemist and reluctant owner of the Moonlit Tavern's back-room apothecary. Sharp-tongued and fiercely independent, she hides genuine warmth behind sarcasm. Brilliant with potions, terrible with money — she's three payments behind to the Ashen Guild. Secretly feeds every stray cat in the alley. Hates being thanked; blushes when compliments land.";
  const MIGRATION = fs.readFileSync(path.resolve(process.cwd(), "migrations/005_inner_self.sql"), "utf8");

  it("round-trips innerSelf; omitted defaults to empty", async () => {
    const c = await saveCharacter({ name: "Orphan", innerSelf: "an orphan — has never told anyone" });
    expect((await getCharacter(c.id))!.innerSelf).toBe("an orphan — has never told anyone");
    const plain = await saveCharacter({ name: "Plain" });
    expect((await getCharacter(plain.id))!.innerSelf).toBe("");
  });

  it("the seed ships split sheets (character row and the story's embedded copy)", async () => {
    const mira = (await getCharacter(MIRA_ID))!;
    expect(mira.innerSelf).toContain("Secretly feeds every stray cat");
    expect(mira.description).not.toContain("Secretly feeds");
    const row = (await get("SELECT characters FROM stories WHERE id=?", [STORY_ID]))!;
    const embedded = JSON.parse(row.characters).find((c: { name: string }) => c.name === "Mira");
    expect(embedded.innerSelf).toContain("Secretly feeds every stray cat");
    expect(embedded.description).not.toContain("Secretly feeds");
  });

  it("the 005 backfill splits an original seed sheet, is idempotent, and spares user edits", async () => {
    // revert Mira to her pre-split sheet, as a not-yet-migrated db would hold it
    await run("UPDATE characters SET description=?, inner_self='' WHERE id=?", [MIRA_OLD, MIRA_ID]);
    await execRaw(MIGRATION);
    let mira = (await getCharacter(MIRA_ID))!;
    expect(mira.innerSelf).toContain("Secretly feeds every stray cat");
    expect(mira.description).not.toContain("Secretly feeds");
    const after = { description: mira.description, innerSelf: mira.innerSelf };

    await execRaw(MIGRATION); // re-run: the WHERE guard no longer matches
    mira = (await getCharacter(MIRA_ID))!;
    expect({ description: mira.description, innerSelf: mira.innerSelf }).toEqual(after);

    // a user-edited sheet never matches the guard and is left alone
    await run("UPDATE characters SET description=?, inner_self='' WHERE id=?", ["my own Mira now", MIRA_ID]);
    await execRaw(MIGRATION);
    mira = (await getCharacter(MIRA_ID))!;
    expect(mira.description).toBe("my own Mira now");
    expect(mira.innerSelf).toBe("");
  });
});

/* The test schema is shared across describes — pagination tests isolate their rows
   with distinctive name prefixes / folders and filter with q. */

describe("cursors", () => {
  it("round-trips", () => {
    expect(decodeCursor(encodeCursor({ v: "Mira", id: "x" }))).toEqual({ v: "Mira", id: "x" });
    expect(decodeCursor(encodeCursor({ v: 42, id: "y" }))).toEqual({ v: 42, id: "y" });
  });
  it("rejects garbage", async () => {
    expect(decodeCursor("not-base64-json")).toBeNull();
    expect(decodeCursor("")).toBeNull();
    await expect(pageCharacters({ cursor: "garbage" })).rejects.toThrow(PageError);
    // type mismatch: a name-shaped cursor against a numeric sort
    await expect(
      pageCharacters({ sort: "updated", cursor: encodeCursor({ v: "abc", id: "x" }) })
    ).rejects.toThrow(PageError);
  });
});

describe("pageCharacters", () => {
  it("walks all pages without dupes or gaps and terminates", async () => {
    for (let i = 0; i < 7; i++) await saveCharacter({ name: `pgwalk-${i}` });
    const seen: string[] = [];
    let cursor: string | null = null;
    let rounds = 0;
    do {
      const page = await pageCharacters({ q: "pgwalk-", limit: 3, cursor, sort: "name" });
      seen.push(...page.items.map((c) => c.name));
      cursor = page.nextCursor;
      if (++rounds > 10) throw new Error("cursor never terminated");
    } while (cursor);
    expect(seen).toEqual([...Array(7)].map((_, i) => `pgwalk-${i}`));
  });

  it("orders name sort case-insensitively", async () => {
    await saveCharacter({ name: "pgsort-Zed" });
    await saveCharacter({ name: "pgsort-alice" });
    const { items } = await pageCharacters({ q: "pgsort-", sort: "name" });
    expect(items.map((c) => c.name)).toEqual(["pgsort-alice", "pgsort-Zed"]);
  });

  it("updated sort is newest-first and pages stably across an id tiebreak", async () => {
    // same-millisecond saves share updated_at, forcing the id tiebreaker
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await saveCharacter({ name: `pgtie-${i}` }));
    const a = await pageCharacters({ q: "pgtie-", limit: 2, sort: "updated" });
    const b = await pageCharacters({ q: "pgtie-", limit: 2, sort: "updated", cursor: a.nextCursor });
    const c = await pageCharacters({ q: "pgtie-", limit: 2, sort: "updated", cursor: b.nextCursor });
    const ids = [...a.items, ...b.items, ...c.items].map((x) => x.id);
    expect(new Set(ids).size).toBe(5);
    expect(new Set(made.map((m) => m.id))).toEqual(new Set(ids));
    expect(c.nextCursor).toBeNull();
  });

  it("q matches name and tag text, with LIKE wildcards escaped", async () => {
    await saveCharacter({ name: "pgq-100%" });
    await saveCharacter({ name: "pgq-100x" });
    await saveCharacter({ name: "pgq-plain", tags: ["pgq-taghit"] });
    expect((await pageCharacters({ q: "pgq-100%" })).items.map((c) => c.name)).toEqual(["pgq-100%"]);
    expect((await pageCharacters({ q: "pgq-taghit" })).items.map((c) => c.name)).toEqual(["pgq-plain"]);
  });

  it("tag filter is exact (jsonb unnest), immune to quoted-tag substring hits", async () => {
    await saveCharacter({ name: `pgtag-quoted`, tags: [`pre"war`] });
    await saveCharacter({ name: `pgtag-war`, tags: ["war"] });
    expect((await pageCharacters({ q: "pgtag-", tag: "war" })).items.map((c) => c.name)).toEqual(["pgtag-war"]);
    expect((await pageCharacters({ q: "pgtag-", tag: `pre"war` })).items.map((c) => c.name)).toEqual(["pgtag-quoted"]);
  });
});

describe("pageChats", () => {
  it("computes decorations in SQL: count, active-variant last message, marker skip, ended", async () => {
    const chat = await saveChat({ title: "pgchat-deco", folder: "pgchat" });
    await appendMessage({ chatId: chat.id, role: "user", content: "first" });
    const tail = await appendMessage({ chatId: chat.id, role: "character", content: "long ".repeat(50) });
    await updateMessage(tail.id, {
      variants: [...(await getMessage(tail.id))!.variants, { content: "picked variant", emotion: null, options: null, createdAt: 1 }],
      activeVariant: 1,
    });
    await appendMessage({ chatId: chat.id, role: "marker", content: "marker noise" });

    const row = (await pageChats({ folder: "pgchat" })).items.find((c) => c.id === chat.id)!;
    expect(row.messageCount).toBe(3);
    expect(row.lastMessage).toBe("picked variant"); // active variant, marker skipped
    expect(row.ended).toBe(false);

    await appendMessage({ chatId: chat.id, role: "narrator", content: "fin", sceneEvent: { theEnd: true } });
    const after = (await pageChats({ folder: "pgchat" })).items.find((c) => c.id === chat.id)!;
    expect(after.ended).toBe(true);
    expect(after.lastMessage.length).toBeLessThanOrEqual(120);
  });

  it("q matches title, tags, live/snapshot character names, persona and story names", async () => {
    const char = await saveCharacter({ name: "pgchats-Mirabel" });
    const persona = await savePersona({ name: "pgchats-Wanderer" });
    const byTitle = await saveChat({ title: "pgchats-title-hit", folder: "pgchatq" });
    const byTag = await saveChat({ title: "x", folder: "pgchatq", tags: ["pgchats-tagged"] });
    const byChar = await saveChat({ title: "y", folder: "pgchatq", characterIds: [char.id] });
    const byPersona = await saveChat({ title: "z", folder: "pgchatq", personaId: persona.id });
    const byStory = await saveChat({
      title: "w",
      folder: "pgchatq",
      storySnapshot: { name: "pgchats-Saga" } as never,
    });
    const bySnapshot = await saveChat({
      title: "v",
      folder: "pgchatq",
      characterIds: ["gone"],
      nameSnapshots: { gone: "pgchats-Ghost" },
    });

    const hit = async (q: string) => (await pageChats({ q, folder: "pgchatq" })).items.map((c) => c.id);
    expect(await hit("pgchats-title")).toEqual([byTitle.id]);
    expect(await hit("pgchats-tagged")).toEqual([byTag.id]);
    expect(await hit("pgchats-Mirabel")).toEqual([byChar.id]);
    expect(await hit("pgchats-Wanderer")).toEqual([byPersona.id]);
    expect(await hit("pgchats-Saga")).toEqual([byStory.id]);
    expect(await hit("pgchats-Ghost")).toEqual([bySnapshot.id]);

    // deleting the character falls back to the chat's own name snapshot
    const snap = await saveChat({
      title: "u",
      folder: "pgchatq",
      characterIds: [char.id],
      nameSnapshots: { [char.id]: "pgchats-Mirabel" },
    });
    await deleteCharacter(char.id);
    expect(await hit("pgchats-Mirabel")).toEqual([snap.id]);
  });
});

describe("searchLibraryNames", () => {
  it("merges types in name order and continues across a type boundary", async () => {
    await saveCharacter({ name: "pgmix-a" });
    await saveScene({ name: "pgmix-b" });
    await saveCharacter({ name: "pgmix-c" });
    const one = await searchLibraryNames({ q: "pgmix-", limit: 2 });
    expect(one.items.map((i) => [i.type, i.name])).toEqual([
      ["character", "pgmix-a"],
      ["scene", "pgmix-b"],
    ]);
    const two = await searchLibraryNames({ q: "pgmix-", limit: 2, cursor: one.nextCursor });
    expect(two.items.map((i) => [i.type, i.name])).toEqual([["character", "pgmix-c"]]);
    expect(two.nextCursor).toBeNull();
  });

  it("narrows to one type", async () => {
    const { items } = await searchLibraryNames({ q: "pgmix-", type: "scene" });
    expect(items.map((i) => i.name)).toEqual(["pgmix-b"]);
  });
});

describe("distinct tags & folders", () => {
  it("dedupes and sorts tags per type", async () => {
    await saveCharacter({ name: "pgdt-1", tags: ["pgdt-Beta", "pgdt-alpha"] });
    await saveCharacter({ name: "pgdt-2", tags: ["pgdt-alpha"] });
    const tags = (await listDistinctTags("character")).filter((t) => t.startsWith("pgdt-"));
    expect(tags).toEqual(["pgdt-alpha", "pgdt-Beta"]);
  });

  it("lists non-empty chat folders", async () => {
    await saveChat({ title: "pgf", folder: "pgfolder-a" });
    await saveChat({ title: "pgf2", folder: "" });
    const folders = await listChatFolders();
    expect(folders).toContain("pgfolder-a");
    expect(folders).not.toContain("");
  });
});

describe("asset refs", () => {
  const aid = (ch: string) => ch.repeat(32);
  const refsOf = async (kind: string, id: string) =>
    (
      await all<{ asset_id: string }>(
        "SELECT asset_id FROM asset_refs WHERE owner_kind=? AND owner_id=? ORDER BY asset_id",
        [kind, id]
      )
    ).map((r) => r.asset_id);

  it("tracks character assets through save, update and delete", async () => {
    const c = await saveCharacter({
      name: "Reffy",
      avatarAsset: aid("a"),
      typingSfxAsset: aid("b"),
      sprites: { happy: aid("c") },
      spriteSfx: { happy: aid("d") },
    });
    expect(await refsOf("character", c.id)).toEqual([aid("a"), aid("b"), aid("c"), aid("d")]);

    // save is a full replace: dropped fields lose their rows, kept ones stay
    await saveCharacter({ id: c.id, avatarAsset: null, sprites: {} });
    expect(await refsOf("character", c.id)).toEqual([aid("b"), aid("d")]);

    await deleteCharacter(c.id);
    expect(await refsOf("character", c.id)).toEqual([]);
  });

  it("tracks scene assets", async () => {
    const s = await saveScene({ name: "Refscene", artworkAsset: aid("e"), bgmAsset: aid("f") });
    expect(await refsOf("scene", s.id)).toEqual([aid("e"), aid("f")]);
  });

  it("story documents and playthrough snapshots hold refs independently", async () => {
    const doc = normalizeStoryDoc({
      name: "Reftale",
      characters: [{ name: "Emb", avatarAsset: aid("1"), sprites: { smug: aid("2") } }],
      locations: [{ name: "Embloc", artworkAsset: aid("3") }],
    });
    const story = await saveStory(doc);
    expect(await refsOf("story", story.id)).toEqual([aid("1"), aid("2"), aid("3")]);

    const chat = await saveChat({ title: "Refplay", mode: "story", storySnapshot: doc });
    expect(await refsOf("chat", chat.id)).toEqual([aid("1"), aid("2"), aid("3")]);

    // a playthrough is self-contained: its refs outlive the story
    await deleteStory(story.id);
    expect(await refsOf("story", story.id)).toEqual([]);
    expect(await refsOf("chat", chat.id)).toEqual([aid("1"), aid("2"), aid("3")]);

    const kept = await listReferencedAssetIds();
    for (const x of ["1", "2", "3"]) expect(kept.has(aid(x))).toBe(true);
    expect(kept.has(aid("a"))).toBe(false); // the deleted character's assets are gone
  });

  it("assetStats splits totals into referenced and unused, in SQL", async () => {
    await registerAsset(aid("s"), "used.png", "image/png", 100);
    await registerAsset(aid("t"), "orphan.png", "image/png", 40);
    await registerAsset(aid("u"), "orphan2.wav", "audio/wav", 5);
    const c = await saveCharacter({ name: "Statsy", avatarAsset: aid("s") });

    const before = await assetStats();
    // ≥: other tests' rows share the schema — the deltas below are what's exact
    expect(before.count).toBeGreaterThanOrEqual(3);
    expect(before.unused.count).toBeGreaterThanOrEqual(2);

    // referencing an orphan moves it out of unused without changing the totals
    await saveCharacter({ id: c.id, avatarAsset: aid("s"), typingSfxAsset: aid("t") });
    const after = await assetStats();
    expect(after.count).toBe(before.count);
    expect(after.bytes).toBe(before.bytes);
    expect(after.unused.count).toBe(before.unused.count - 1);
    expect(after.unused.bytes).toBe(before.unused.bytes - 40);
  });
});

describe("pageFacts", () => {
  it("pages one character's facts with fail-soft source-chat titles", async () => {
    const c = await saveCharacter({ name: "Facty" });
    const other = await saveCharacter({ name: "Bystander" });
    const chat = await saveChat({ title: "source chat" });
    const inChat = await addFact(c.id, chat.id, "learned the password");
    const noChat = await addFact(c.id, null, "hates thunderstorms");
    await addFact(other.id, chat.id, "someone else's memory");

    // paged in two, cursor-linked, no leak from the other character
    const p1 = await pageFacts(c.id, { limit: 1 });
    expect(p1.items).toHaveLength(1);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await pageFacts(c.id, { limit: 1, cursor: p1.nextCursor });
    expect(p2.nextCursor).toBeNull();
    const ids = [...p1.items, ...p2.items].map((f) => f.id).sort();
    expect(ids).toEqual([inChat.id, noChat.id].sort());

    const titleOf = (id: string) =>
      [...p1.items, ...p2.items].find((f) => f.id === id)?.chatTitle ?? null;
    expect(titleOf(inChat.id)).toBe("source chat");
    expect(titleOf(noChat.id)).toBeNull();

    // the source chat's deletion degrades the title, never the fact
    await deleteChat(chat.id);
    const after = await pageFacts(c.id, {});
    expect(after.items.map((f) => f.id).sort()).toEqual(ids);
    expect(after.items.find((f) => f.id === inChat.id)?.chatTitle).toBeNull();
  });
});

describe("story bonds & director reads (playthrough-scoped)", () => {
  it("round-trips bonds keyed by snapshot cast id (no character row needed)", async () => {
    const chat = await saveChat({ title: "bonds" });
    // embedded cast ids have no characters row — the table must accept them
    expect(await getStoryBonds(chat.id, "embedded-1")).toBeNull();
    const bonds = [{ towards: "Mira", stance: "guarded", note: "she saw the scar" }];
    await putStoryBonds(chat.id, "embedded-1", bonds);
    expect((await getStoryBonds(chat.id, "embedded-1"))?.bonds).toEqual(bonds);
    // replacement, not merge
    const next = [{ towards: "Mira", stance: "wavering", note: "" }];
    await putStoryBonds(chat.id, "embedded-1", next);
    expect((await getStoryBonds(chat.id, "embedded-1"))?.bonds).toEqual(next);
    expect(await listStoryBonds(chat.id)).toHaveLength(1);
    // bonds die with the chat (ON DELETE CASCADE)
    await deleteChat(chat.id);
    expect(await listStoryBonds(chat.id)).toEqual([]);
  });

  it("director reads are scene-keyed: a scene change invalidates by mismatch", async () => {
    const chat = await saveChat({ title: "reads" });
    expect(await getDirectorRead(chat.id, "s1")).toBeNull();
    await putDirectorRead(chat.id, "s1", "near", "escalate");
    expect(await getDirectorRead(chat.id, "s1")).toEqual({ exit: "near", beat: "escalate" });
    // read from another scene — stale, treated as absent
    expect(await getDirectorRead(chat.id, "s2")).toBeNull();
    // one row per chat: the new scene's read replaces the old — and every write
    // replaces the beat (omitted = cleared; a stale beat is worse than none)
    await putDirectorRead(chat.id, "s2", "met");
    expect(await getDirectorRead(chat.id, "s2")).toEqual({ exit: "met", beat: null });
    expect(await getDirectorRead(chat.id, "s1")).toBeNull();
    await deleteChat(chat.id);
  });
});
