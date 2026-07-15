import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Chat, Message, MessageRole, SceneEvent } from "@/lib/types";

// novel.ts reads through the store (speaker names) — point it at a throwaway DB.
process.env.ANIMACHAT_DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "animachat-test-")),
  "test.db"
);
import { chunkByTokens, splitChapters, toMarkdown, transcriptForModel } from "./novel";

const chat: Chat = {
  id: "chat1",
  title: "Test",
  mode: "casual",
  folder: "",
  tags: [],
  storyId: null,
  sceneId: null,
  locationId: null,
  lorebookIds: [],
  characterIds: ["c1"],
  personaId: null,
  personaCharacterId: null,
  storySnapshot: null,
  nameSnapshots: { c1: "Mira" },
  modelId: null,
  charModels: {},
  language: "",
  pov: "",
  narratorEnabled: true,
  playAsNarrator: false,
  overrides: {},
  createdAt: 0,
  updatedAt: 0,
};

function msg(
  i: number,
  role: MessageRole,
  content: string,
  extra?: { characterId?: string; sceneEvent?: SceneEvent }
): Message {
  return {
    id: `m${i}`,
    chatId: chat.id,
    position: i,
    role,
    characterId: extra?.characterId ?? null,
    variants: [{ content, emotion: null, options: null, createdAt: 0 }],
    activeVariant: 0,
    sceneEvent: extra?.sceneEvent ?? null,
    createdAt: 0,
  };
}

describe("splitChapters", () => {
  it("puts a scene-advancing message into the chapter it opens", () => {
    const messages = [
      msg(0, "user", "hello"),
      msg(1, "narrator", "the scene shifts", { sceneEvent: { sceneId: "s-unknown" } }),
      msg(2, "user", "onward"),
    ];
    const chapters = splitChapters(chat, messages);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toBeNull();
    expect(chapters[0].messages.map((m) => m.id)).toEqual(["m0"]);
    // unknown scene id (not in a snapshot) falls back to a generic title
    expect(chapters[1].title).toBe("New scene");
    expect(chapters[1].messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("opens a 'The End' chapter after the concluding message; epilogue falls into it", () => {
    const messages = [
      msg(0, "narrator", "it ends", { sceneEvent: { theEnd: true } }),
      msg(1, "user", "what a ride"),
    ];
    const chapters = splitChapters(chat, messages);
    expect(chapters.map((c) => c.title)).toEqual([null, "The End"]);
    expect(chapters[0].messages.map((m) => m.id)).toEqual(["m0"]);
    expect(chapters[1].messages.map((m) => m.id)).toEqual(["m1"]);
  });

  it("keeps an empty titled chapter and drops markers and empty messages", () => {
    const messages = [
      msg(0, "user", "hi"),
      msg(1, "marker", "checkpoint"),
      msg(2, "narrator", ""),
      msg(3, "narrator", "fin", { sceneEvent: { theEnd: true } }),
    ];
    const chapters = splitChapters(chat, messages);
    expect(chapters.map((c) => c.title)).toEqual([null, "The End"]);
    expect(chapters[0].messages.map((m) => m.id)).toEqual(["m0", "m3"]);
    expect(chapters[1].messages).toEqual([]);
  });
});

describe("toMarkdown", () => {
  it("renders speaker labels, italic narrator lines, and headings", () => {
    const messages = [
      msg(0, "user", "hello there"),
      msg(1, "character", `*smiles* "Welcome."`, { characterId: "c1" }),
      msg(2, "narrator", "*Night falls.*"),
      msg(3, "narrator", "fin", { sceneEvent: { theEnd: true } }),
    ];
    const md = toMarkdown(chat, messages);
    expect(md).toContain("# Test");
    expect(md).toContain("**You:** hello there");
    expect(md).toContain(`**Mira:** *smiles* "Welcome."`); // name from nameSnapshots fallback
    expect(md).toContain("*Night falls.*"); // narrator asterisks not doubled
    expect(md).toContain("## The End");
  });

  it("flattens mention tags to plain @Name", () => {
    const md = toMarkdown(chat, [msg(0, "character", "<mention>Mira</mention> look!", { characterId: "c1" })]);
    expect(md).toContain("@Mira look!");
    expect(md).not.toContain("<mention>");
  });
});

describe("chunkByTokens", () => {
  it("packs messages up to the budget, never splitting one", () => {
    const messages = [
      msg(0, "user", "a".repeat(400)), // ~100 tokens each
      msg(1, "user", "b".repeat(400)),
      msg(2, "user", "c".repeat(400)),
    ];
    const chunks = chunkByTokens(messages, 200);
    expect(chunks.map((c) => c.map((m) => m.id))).toEqual([["m0", "m1"], ["m2"]]);
  });

  it("a single oversized message still forms its own chunk", () => {
    const chunks = chunkByTokens([msg(0, "user", "x".repeat(4000))], 100);
    expect(chunks).toHaveLength(1);
  });
});

describe("transcriptForModel", () => {
  it("labels every line with the speaker, narrator included", () => {
    const t = transcriptForModel(chat, [
      msg(0, "user", "hi"),
      msg(1, "narrator", "Rain taps the window."),
      msg(2, "character", `"Hello."`, { characterId: "c1" }),
    ]);
    expect(t).toBe(`You: hi\n\nNarrator: Rain taps the window.\n\nMira: "Hello."`);
  });
});
