import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// the store opens its connection lazily on first query — setting the env here is safe
process.env.ANIMACHAT_DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "animachat-test-")),
  "test.db"
);
import {
  PageError,
  addVariant,
  appendMessage,
  decodeCursor,
  deleteCharacter,
  encodeCursor,
  getMessage,
  listChatFolders,
  listDistinctTags,
  pageCharacters,
  pageChats,
  pageMessages,
  saveChat,
  saveCharacter,
  savePersona,
  saveScene,
  saveStory,
  searchLibraryNames,
  updateMessage,
} from "./store";

describe("appendMessage tail freeze", () => {
  it("collapses the previous tail's variants to the active one when a follow-up lands", () => {
    const chat = saveChat({ title: "freeze" });
    const first = appendMessage({ chatId: chat.id, role: "character", content: "take one" });
    updateMessage(first.id, {
      variants: [...first.variants, { content: "take two", emotion: "smug", options: null, createdAt: 1 }],
      activeVariant: 1,
    });

    appendMessage({ chatId: chat.id, role: "user", content: "reply" });

    const frozen = getMessage(first.id)!;
    expect(frozen.variants).toHaveLength(1);
    expect(frozen.variants[0].content).toBe("take two"); // the chosen variant survives
    expect(frozen.activeVariant).toBe(0);
  });

  it("leaves the new tail's own variants intact", () => {
    const chat = saveChat({ title: "freeze2" });
    appendMessage({ chatId: chat.id, role: "user", content: "hi" });
    const tail = appendMessage({ chatId: chat.id, role: "character", content: "a" });
    updateMessage(tail.id, {
      variants: [...tail.variants, { content: "b", emotion: null, options: null, createdAt: 1 }],
      activeVariant: 1,
    });
    expect(getMessage(tail.id)!.variants).toHaveLength(2);
  });
});

describe("updateMessage activeVariant clamp", () => {
  it("rejects negative and fractional indexes (they would poison pageChats' JSON path)", () => {
    const chat = saveChat({ title: "clamp" });
    const m = appendMessage({ chatId: chat.id, role: "character", content: "only" });
    expect(updateMessage(m.id, { activeVariant: -1 })!.activeVariant).toBe(0);
    expect(updateMessage(m.id, { activeVariant: 0.5 })!.activeVariant).toBe(0);
    expect(updateMessage(m.id, { activeVariant: 99 })!.activeVariant).toBe(0);
  });
});

describe("addVariant", () => {
  it("appends a swipe to the tail and re-reads fresh variants", () => {
    const chat = saveChat({ title: "regen" });
    appendMessage({ chatId: chat.id, role: "user", content: "hi" });
    const tail = appendMessage({ chatId: chat.id, role: "character", content: "take one" });
    const saved = addVariant(tail.id, { content: "take two", emotion: null, options: null, createdAt: 1 });
    expect(saved!.variants.map((v) => v.content)).toEqual(["take one", "take two"]);
    expect(saved!.activeVariant).toBe(1);
  });

  it("refuses a message that is no longer the tail (regen raced a new message)", () => {
    const chat = saveChat({ title: "regen race" });
    const target = appendMessage({ chatId: chat.id, role: "character", content: "old tail" });
    appendMessage({ chatId: chat.id, role: "user", content: "moved on" });
    const saved = addVariant(target.id, { content: "late regen", emotion: null, options: null, createdAt: 1 });
    expect(saved).toBeNull();
    expect(getMessage(target.id)!.variants).toHaveLength(1);
  });
});

describe("per-variant sceneEvent", () => {
  it("swiping switches the message's stage event to the active variant's", () => {
    const chat = saveChat({ title: "per-variant events" });
    appendMessage({ chatId: chat.id, role: "user", content: "hi" });
    const tail = appendMessage({
      chatId: chat.id,
      role: "narrator",
      content: "v1 ends it",
      sceneEvent: { theEnd: true },
    });
    const saved = addVariant(tail.id, {
      content: "v2 keeps going",
      emotion: null,
      options: null,
      sceneEvent: null,
      createdAt: 1,
    })!;
    expect(saved.sceneEvent).toBeNull(); // the regen carried no stage tags
    expect(updateMessage(tail.id, { activeVariant: 0 })!.sceneEvent).toEqual({ theEnd: true });
    expect(updateMessage(tail.id, { activeVariant: 1 })!.sceneEvent).toBeNull();
  });

  it("variants from before events lived on them keep the message-level event", () => {
    const chat = saveChat({ title: "legacy variants" });
    const m = appendMessage({
      chatId: chat.id,
      role: "narrator",
      content: "old row",
      sceneEvent: { theEnd: true },
    });
    // simulate a pre-field row: variant without the sceneEvent key
    updateMessage(m.id, { variants: [{ content: "old row", emotion: null, options: null, createdAt: 1 }] });
    expect(getMessage(m.id)!.sceneEvent).toEqual({ theEnd: true });
  });

  it("an explicit sceneEvent edit is mirrored onto the active variant", () => {
    const chat = saveChat({ title: "event edit" });
    appendMessage({ chatId: chat.id, role: "user", content: "hi" });
    const tail = appendMessage({ chatId: chat.id, role: "narrator", content: "v1", sceneEvent: null });
    addVariant(tail.id, { content: "v2", emotion: null, options: null, sceneEvent: null, createdAt: 1 });
    updateMessage(tail.id, { sceneEvent: { theEnd: true } }); // edit while v2 is active
    updateMessage(tail.id, { activeVariant: 0 });
    const back = updateMessage(tail.id, { activeVariant: 1 })!; // swipe away and back
    expect(back.sceneEvent).toEqual({ theEnd: true });
  });
});

describe("pageMessages", () => {
  it("walks the whole timeline newest-first in keyset pages, without gaps or repeats", () => {
    const chat = saveChat({ title: "paging" });
    for (let i = 0; i < 7; i++) appendMessage({ chatId: chat.id, role: "user", content: `m${i}` });

    const p1 = pageMessages(chat.id, { limit: 3 });
    expect(p1.items.map((m) => m.variants[0].content)).toEqual(["m6", "m5", "m4"]);
    const p2 = pageMessages(chat.id, { limit: 3, cursor: p1.nextCursor });
    expect(p2.items.map((m) => m.variants[0].content)).toEqual(["m3", "m2", "m1"]);
    const p3 = pageMessages(chat.id, { limit: 3, cursor: p2.nextCursor });
    expect(p3.items.map((m) => m.variants[0].content)).toEqual(["m0"]);
    expect(p3.nextCursor).toBeNull();
  });

  it("has no next page when the last page is exactly full", () => {
    const chat = saveChat({ title: "paging exact" });
    appendMessage({ chatId: chat.id, role: "user", content: "a" });
    appendMessage({ chatId: chat.id, role: "user", content: "b" });
    const p = pageMessages(chat.id, { limit: 2 });
    expect(p.items).toHaveLength(2);
    expect(p.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor", () => {
    const chat = saveChat({ title: "paging cursor" });
    expect(() => pageMessages(chat.id, { cursor: "garbage" })).toThrow(PageError);
    expect(() => pageMessages(chat.id, { cursor: encodeCursor({ v: "not-a-position" }) })).toThrow(
      PageError
    );
  });
});

describe("saveStory (embedded document)", () => {
  it("normalizes embedded items and self-heals internal references", () => {
    const story = saveStory({
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
  });
});

/* The test db is shared across describes — pagination tests isolate their rows
   with distinctive name prefixes / folders and filter with q. */

describe("cursors", () => {
  it("round-trips", () => {
    expect(decodeCursor(encodeCursor({ v: "Mira", id: "x" }))).toEqual({ v: "Mira", id: "x" });
    expect(decodeCursor(encodeCursor({ v: 42, id: "y" }))).toEqual({ v: 42, id: "y" });
  });
  it("rejects garbage", () => {
    expect(decodeCursor("not-base64-json")).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(() => pageCharacters({ cursor: "garbage" })).toThrow(PageError);
    // type mismatch: a name-shaped cursor against a numeric sort
    expect(() => pageCharacters({ sort: "updated", cursor: encodeCursor({ v: "abc", id: "x" }) })).toThrow(
      PageError
    );
  });
});

describe("pageCharacters", () => {
  it("walks all pages without dupes or gaps and terminates", () => {
    for (let i = 0; i < 7; i++) saveCharacter({ name: `pgwalk-${i}` });
    const seen: string[] = [];
    let cursor: string | null = null;
    let rounds = 0;
    do {
      const page = pageCharacters({ q: "pgwalk-", limit: 3, cursor, sort: "name" });
      seen.push(...page.items.map((c) => c.name));
      cursor = page.nextCursor;
      if (++rounds > 10) throw new Error("cursor never terminated");
    } while (cursor);
    expect(seen).toEqual([...Array(7)].map((_, i) => `pgwalk-${i}`));
  });

  it("orders name sort case-insensitively", () => {
    saveCharacter({ name: "pgsort-Zed" });
    saveCharacter({ name: "pgsort-alice" });
    const { items } = pageCharacters({ q: "pgsort-", sort: "name" });
    expect(items.map((c) => c.name)).toEqual(["pgsort-alice", "pgsort-Zed"]);
  });

  it("updated sort is newest-first and pages stably across an id tiebreak", () => {
    // same-millisecond saves share updated_at, forcing the id tiebreaker
    const made = [...Array(5)].map((_, i) => saveCharacter({ name: `pgtie-${i}` }));
    const a = pageCharacters({ q: "pgtie-", limit: 2, sort: "updated" });
    const b = pageCharacters({ q: "pgtie-", limit: 2, sort: "updated", cursor: a.nextCursor });
    const c = pageCharacters({ q: "pgtie-", limit: 2, sort: "updated", cursor: b.nextCursor });
    const ids = [...a.items, ...b.items, ...c.items].map((x) => x.id);
    expect(new Set(ids).size).toBe(5);
    expect(new Set(made.map((m) => m.id))).toEqual(new Set(ids));
    expect(c.nextCursor).toBeNull();
  });

  it("q matches name and tag text, with LIKE wildcards escaped", () => {
    saveCharacter({ name: "pgq-100%" });
    saveCharacter({ name: "pgq-100x" });
    saveCharacter({ name: "pgq-plain", tags: ["pgq-taghit"] });
    expect(pageCharacters({ q: "pgq-100%" }).items.map((c) => c.name)).toEqual(["pgq-100%"]);
    expect(pageCharacters({ q: "pgq-taghit" }).items.map((c) => c.name)).toEqual(["pgq-plain"]);
  });

  it("tag filter is exact (json_each), immune to quoted-tag substring hits", () => {
    saveCharacter({ name: `pgtag-quoted`, tags: [`pre"war`] });
    saveCharacter({ name: `pgtag-war`, tags: ["war"] });
    expect(pageCharacters({ q: "pgtag-", tag: "war" }).items.map((c) => c.name)).toEqual(["pgtag-war"]);
    expect(pageCharacters({ q: "pgtag-", tag: `pre"war` }).items.map((c) => c.name)).toEqual(["pgtag-quoted"]);
  });
});

describe("pageChats", () => {
  it("computes decorations in SQL: count, active-variant last message, marker skip, ended", () => {
    const chat = saveChat({ title: "pgchat-deco", folder: "pgchat" });
    appendMessage({ chatId: chat.id, role: "user", content: "first" });
    const tail = appendMessage({ chatId: chat.id, role: "character", content: "long ".repeat(50) });
    updateMessage(tail.id, {
      variants: [...getMessage(tail.id)!.variants, { content: "picked variant", emotion: null, options: null, createdAt: 1 }],
      activeVariant: 1,
    });
    appendMessage({ chatId: chat.id, role: "marker", content: "marker noise" });

    const row = pageChats({ folder: "pgchat" }).items.find((c) => c.id === chat.id)!;
    expect(row.messageCount).toBe(3);
    expect(row.lastMessage).toBe("picked variant"); // active variant, marker skipped
    expect(row.ended).toBe(false);

    appendMessage({ chatId: chat.id, role: "narrator", content: "fin", sceneEvent: { theEnd: true } });
    const after = pageChats({ folder: "pgchat" }).items.find((c) => c.id === chat.id)!;
    expect(after.ended).toBe(true);
    expect(after.lastMessage.length).toBeLessThanOrEqual(120);
  });

  it("q matches title, tags, live/snapshot character names, persona and story names", () => {
    const char = saveCharacter({ name: "pgchats-Mirabel" });
    const persona = savePersona({ name: "pgchats-Wanderer" });
    const byTitle = saveChat({ title: "pgchats-title-hit", folder: "pgchatq" });
    const byTag = saveChat({ title: "x", folder: "pgchatq", tags: ["pgchats-tagged"] });
    const byChar = saveChat({ title: "y", folder: "pgchatq", characterIds: [char.id] });
    const byPersona = saveChat({ title: "z", folder: "pgchatq", personaId: persona.id });
    const byStory = saveChat({
      title: "w",
      folder: "pgchatq",
      storySnapshot: { name: "pgchats-Saga" } as never,
    });
    const bySnapshot = saveChat({
      title: "v",
      folder: "pgchatq",
      characterIds: ["gone"],
      nameSnapshots: { gone: "pgchats-Ghost" },
    });

    const hit = (q: string) => pageChats({ q, folder: "pgchatq" }).items.map((c) => c.id);
    expect(hit("pgchats-title")).toEqual([byTitle.id]);
    expect(hit("pgchats-tagged")).toEqual([byTag.id]);
    expect(hit("pgchats-Mirabel")).toEqual([byChar.id]);
    expect(hit("pgchats-Wanderer")).toEqual([byPersona.id]);
    expect(hit("pgchats-Saga")).toEqual([byStory.id]);
    expect(hit("pgchats-Ghost")).toEqual([bySnapshot.id]);

    // deleting the character falls back to the chat's own name snapshot
    const snap = saveChat({
      title: "u",
      folder: "pgchatq",
      characterIds: [char.id],
      nameSnapshots: { [char.id]: "pgchats-Mirabel" },
    });
    deleteCharacter(char.id);
    expect(hit("pgchats-Mirabel")).toEqual([snap.id]);
  });
});

describe("searchLibraryNames", () => {
  it("merges types in name order and continues across a type boundary", () => {
    saveCharacter({ name: "pgmix-a" });
    saveScene({ name: "pgmix-b" });
    saveCharacter({ name: "pgmix-c" });
    const one = searchLibraryNames({ q: "pgmix-", limit: 2 });
    expect(one.items.map((i) => [i.type, i.name])).toEqual([
      ["character", "pgmix-a"],
      ["scene", "pgmix-b"],
    ]);
    const two = searchLibraryNames({ q: "pgmix-", limit: 2, cursor: one.nextCursor });
    expect(two.items.map((i) => [i.type, i.name])).toEqual([["character", "pgmix-c"]]);
    expect(two.nextCursor).toBeNull();
  });

  it("narrows to one type", () => {
    const { items } = searchLibraryNames({ q: "pgmix-", type: "scene" });
    expect(items.map((i) => i.name)).toEqual(["pgmix-b"]);
  });
});

describe("distinct tags & folders", () => {
  it("dedupes and sorts tags per type", () => {
    saveCharacter({ name: "pgdt-1", tags: ["pgdt-Beta", "pgdt-alpha"] });
    saveCharacter({ name: "pgdt-2", tags: ["pgdt-alpha"] });
    const tags = listDistinctTags("character").filter((t) => t.startsWith("pgdt-"));
    expect(tags).toEqual(["pgdt-alpha", "pgdt-Beta"]);
  });

  it("lists non-empty chat folders", () => {
    saveChat({ title: "pgf", folder: "pgfolder-a" });
    saveChat({ title: "pgf2", folder: "" });
    const folders = listChatFolders();
    expect(folders).toContain("pgfolder-a");
    expect(folders).not.toContain("");
  });
});
