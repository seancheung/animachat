import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCharacterRequest, type ChatContext } from "./prompts";
import { substitutePlaceholders } from "./placeholders";
import type { Character, Chat, Message, MessageRole } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import type { ResolvedModel } from "./client";

// prompts.ts reads facts/relationships through the store — point it at a throwaway DB
process.env.ANIMACHAT_DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "animachat-test-")),
  "test.db"
);

function makeCharacter(id: string, name: string): Character {
  return {
    id,
    name,
    avatarAsset: null,
    description: "Keeper of the moonlit tavern.",
    greeting: "",
    exampleDialogue: `"Welcome, traveler."`,
    imagePrompt: "",
    sprites: {},
    customExpressions: [],
    typingSfxAsset: null,
    trackRelationship: false,
    idleMotion: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

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
  modelId: null,
  charModels: {},
  language: "",
  pov: "",
  narratorEnabled: false,
  overrides: {},
  createdAt: 0,
  updatedAt: 0,
};

const modelRef: ResolvedModel = {
  model: {
    id: "m1",
    providerId: "p1",
    modelId: "test-model",
    displayName: "Test",
    contextWindow: 128000,
    customBody: null,
    createdAt: 0,
  },
  provider: {
    id: "p1",
    name: "Test",
    type: "openai",
    baseUrl: "http://localhost",
    apiKey: "",
    createdAt: 0,
  },
};

function makeMessages(turns: { role: MessageRole; characterId?: string }[]): Message[] {
  return turns.map((t, i) => ({
    id: `m${i}`,
    chatId: chat.id,
    position: i,
    role: t.role,
    characterId: t.characterId ?? null,
    variants: [{ content: `message ${i}`, emotion: null, options: null, createdAt: 0 }],
    activeVariant: 0,
    sceneEvent: null,
    createdAt: 0,
  }));
}

function makeCtx(messages: Message[], characters: Character[]): ChatContext {
  return {
    chat,
    settings: DEFAULT_SETTINGS,
    language: "English",
    pov: "user1st",
    characters,
    persona: null,
    story: null,
    stage: { sceneId: null, locationId: null },
    scene: null,
    location: null,
    lorebooks: [],
    messages,
    summaryText: "",
    summaryCovered: -1,
    contextBudget: () => 32000,
    verbatimShare: 0.35,
    chunkThreshold: 3000,
    sub: (text) => text,
  };
}

function exchange(characterId: string, ownReplies: number): { role: MessageRole; characterId?: string }[] {
  const out: { role: MessageRole; characterId?: string }[] = [];
  for (let i = 0; i < ownReplies; i++) {
    out.push({ role: "user" }, { role: "character", characterId });
  }
  return out;
}

describe("buildCharacterRequest", () => {
  const mira = makeCharacter("c1", "Mira");

  it("includes example dialogue early in a chat", () => {
    const ctx = makeCtx(makeMessages(exchange("c1", 2)), [mira]);
    const req = buildCharacterRequest(ctx, mira, modelRef);
    expect(req.system).toContain("EXAMPLE OF HOW Mira SPEAKS");
  });

  it("drops example dialogue once the character has enough replies in the window", () => {
    const ctx = makeCtx(makeMessages(exchange("c1", 8)), [mira]);
    const req = buildCharacterRequest(ctx, mira, modelRef);
    expect(req.system).not.toContain("EXAMPLE OF HOW");
  });

  it("counts only the character's own replies toward the fade", () => {
    const kael = makeCharacter("c2", "Kael");
    const messages = makeMessages([...exchange("c2", 10), ...exchange("c1", 2)]);
    const ctx = makeCtx(messages, [mira, kael]);
    const req = buildCharacterRequest(ctx, mira, modelRef);
    expect(req.system).toContain("EXAMPLE OF HOW Mira SPEAKS");
    expect(buildCharacterRequest(ctx, kael, modelRef).system).not.toContain("EXAMPLE OF HOW");
  });

  it("binds [char_name] in a sheet to that sheet's character, not the chat's first character", () => {
    const kael = makeCharacter("c2", "Kael");
    kael.description = "[char_name] of Varr, knight-errant.";
    const ctx = makeCtx(makeMessages(exchange("c1", 1)), [mira, kael]);
    ctx.sub = (text, selfName) =>
      substitutePlaceholders(text, { characterNames: ["Mira", "Kael"], selfName });
    const req = buildCharacterRequest(ctx, kael, modelRef);
    expect(req.system).toContain("Kael of Varr");
    // and in Mira's prompt, Kael's sheet in OTHER CHARACTERS still resolves to Kael
    expect(buildCharacterRequest(ctx, mira, modelRef).system).toContain("Kael of Varr");
  });

  it("always instructs against reciting the character sheet", () => {
    const ctx = makeCtx(makeMessages(exchange("c1", 1)), [mira]);
    const req = buildCharacterRequest(ctx, mira, modelRef);
    expect(req.system).toContain("private background knowledge");
  });
});
