import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCharacterRequest,
  buildDirectorRequest,
  buildNarratorRequest,
  computeStage,
  resolveStageAssets,
  type ChatContext,
} from "./prompts";
import { substitutePlaceholders } from "./placeholders";
import { entranceSceneId, nextSceneIdAfter } from "@/lib/stage";
import type { Character, Chat, Message, MessageRole, Scene, SceneEvent, StorySnapshot } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import type { ResolvedModel } from "./client";

// prompts.ts reads through the store — point it at a throwaway DB. The store opens
// its connection lazily on first query, so setting the env here (after imports) is safe.
process.env.ANIMACHAT_DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "animachat-test-")),
  "test.db"
);
import { saveLocation, saveScene } from "@/lib/store";

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
    spriteSfx: {},
    customExpressions: [],
    typingSfxAsset: null,
    tags: [],
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
  personaCharacterId: null,
  storySnapshot: null,
  nameSnapshots: {},
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
    inputPrice: null,
    cacheReadPrice: null,
    cacheWritePrice: null,
    outputPrice: null,
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
    present: characters,
    persona: null,
    playedCharacter: null,
    snapshot: null,
    stage: { sceneId: null, locationId: null, present: null, revealed: [], ended: false },
    scene: null,
    location: null,
    ended: false,
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

const stageOf = (sceneId: string | null, locationId: string | null) => ({
  sceneId,
  locationId,
  present: null,
  revealed: [],
  ended: false,
});

describe("resolveStageAssets stage style", () => {
  it("merges per-field with location fields winning, and strips the enabled flag", () => {
    const loc = saveLocation({ name: "L1", stageStyle: { enabled: true, panelBg: "#111111", accent: "#aaaaaa" } });
    const scn = saveScene({ name: "S1", locationId: loc.id, stageStyle: { enabled: true, panelBg: "#222222", stageBg: "#000000" } });
    const st = resolveStageAssets(chat, stageOf(scn.id, loc.id)).stageStyle;
    expect(st).toMatchObject({ panelBg: "#111111", accent: "#aaaaaa", stageBg: "#000000" });
    expect(st).not.toHaveProperty("enabled");
  });

  it("styles are opt-in: a style without enabled: true contributes nothing", () => {
    const loc = saveLocation({ name: "L2", stageStyle: { panelBg: "#111111" } });
    const scn = saveScene({ name: "S2", locationId: loc.id, stageStyle: { enabled: true, panelBg: "#222222" } });
    expect(resolveStageAssets(chat, stageOf(scn.id, loc.id)).stageStyle?.panelBg).toBe("#222222");
  });

  it("returns null when the only style is not enabled", () => {
    const off = saveLocation({ name: "L3", stageStyle: { panelBg: "#111111", enabled: false } });
    expect(resolveStageAssets(chat, stageOf(null, off.id)).stageStyle).toBeNull();
    const absent = saveLocation({ name: "L4", stageStyle: { panelBg: "#111111" } });
    expect(resolveStageAssets(chat, stageOf(null, absent.id)).stageStyle).toBeNull();
  });
});

/* ---------------- playthrough stage derivation ---------------- */

function makeScene(id: string, name: string): Scene {
  return {
    id,
    name,
    setup: "",
    imagePrompt: "",
    locationId: null,
    artworkAsset: null,
    bgmAsset: null,
    ambientAsset: null,
    stageStyle: null,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("computeStage (playthrough presence & ending)", () => {
  const snapshot: StorySnapshot = {
    name: "Test story",
    description: "",
    destination: "",
    secrets: [],
    characters: [makeCharacter("c1", "Mira"), makeCharacter("c2", "Kael")],
    scenes: [
      { scene: makeScene("s1", "Opening"), cast: ["c1"], goal: "", obstacles: "", exit: "" },
      { scene: makeScene("s2", "Finale"), cast: ["c1", "c2"], goal: "", obstacles: "", exit: "" },
    ],
    locations: [],
    lorebooks: [],
  };
  const playChat: Chat = {
    ...chat,
    mode: "story",
    characterIds: ["c1", "c2"],
    storySnapshot: snapshot,
  };
  const narratorEvent = (position: number, ev: SceneEvent): Message => ({
    id: `n${position}`,
    chatId: playChat.id,
    position,
    role: "narrator",
    characterId: null,
    variants: [{ content: "…", emotion: null, options: null, createdAt: 0 }],
    activeVariant: 0,
    sceneEvent: ev,
    createdAt: 0,
  });

  it("opens on the first scene with its cast", () => {
    const st = computeStage(playChat, []);
    expect(st.sceneId).toBe("s1");
    expect(st.present).toEqual(["c1"]);
    expect(st.ended).toBe(false);
  });

  it("folds enter/leave events; a scene change resets to the new scene's cast", () => {
    const msgs = [
      narratorEvent(0, { enter: ["c2"] }),
      narratorEvent(1, { leave: ["c1"] }),
    ];
    let st = computeStage(playChat, msgs);
    expect(st.present).toEqual(["c2"]);
    st = computeStage(playChat, [...msgs, narratorEvent(2, { sceneId: "s2" })]);
    expect(st.sceneId).toBe("s2");
    expect(st.present).toEqual(["c1", "c2"]);
  });

  it("never puts the played character (a non-participant) on stage", () => {
    const asMira: Chat = { ...playChat, characterIds: ["c2"], personaCharacterId: "c1" };
    const st = computeStage(asMira, [narratorEvent(0, { sceneId: "s2" })]);
    expect(st.present).toEqual(["c2"]);
  });

  it("derives the ended flag, and rewinding before The End un-ends the story", () => {
    const msgs = [narratorEvent(0, { sceneId: "s2" }), narratorEvent(1, { theEnd: true })];
    expect(computeStage(playChat, msgs).ended).toBe(true);
    expect(computeStage(playChat, msgs, 0).ended).toBe(false);
  });

  it("folds reveal events, and rewinding before a reveal un-reveals it", () => {
    const msgs = [narratorEvent(0, { enter: ["c2"] }), narratorEvent(1, { reveal: ["sec1"] })];
    expect(computeStage(playChat, msgs).revealed).toEqual(["sec1"]);
    expect(computeStage(playChat, msgs, 0).revealed).toEqual([]);
  });
});

describe("story knowledge boundaries (secrets & reveals)", () => {
  const mira = makeCharacter("c1", "Mira");
  const kael = makeCharacter("c2", "Kael");
  const secret = {
    id: "sec1",
    title: "Kael's own debt",
    content: "Kael owes the Ashen Guild too.",
    knownBy: ["c2"],
    revealHint: "when the Guild is named to his face",
  };

  function storyCtx(revealed: string[]): ChatContext {
    const snapshot: StorySnapshot = {
      name: "Test story",
      description: "A night of debts.",
      destination: "Ends at dawn when the collectors knock.",
      secrets: [secret],
      characters: [mira, kael],
      scenes: [
        {
          scene: makeScene("s1", "Opening"),
          cast: ["c1", "c2"],
          goal: "Entangle the user in the debt",
          obstacles: "Mira's pride",
          exit: "someone commits to helping",
        },
      ],
      locations: [],
      lorebooks: [],
    };
    const ctx = makeCtx(makeMessages(exchange("c1", 1)), [mira, kael]);
    return {
      ...ctx,
      chat: { ...chat, mode: "story", narratorEnabled: true, storySnapshot: snapshot },
      snapshot,
      stage: { sceneId: "s1", locationId: null, present: ["c1", "c2"], revealed, ended: false },
    };
  }

  it("only the holder carries an unrevealed secret; others never see it", () => {
    const ctx = storyCtx([]);
    const kaelReq = buildCharacterRequest(ctx, kael, modelRef);
    expect(kaelReq.system).toContain("SECRETS KAEL KEEPS");
    expect(kaelReq.system).toContain("Kael owes the Ashen Guild too.");
    const miraReq = buildCharacterRequest(ctx, mira, modelRef);
    expect(miraReq.system).not.toContain("Kael owes the Ashen Guild too.");
  });

  it("a revealed secret becomes open truth for everyone and leaves the guarded block", () => {
    const ctx = storyCtx(["sec1"]);
    const miraReq = buildCharacterRequest(ctx, mira, modelRef);
    expect(miraReq.system).toContain("TRUTHS NOW IN THE OPEN");
    expect(miraReq.system).toContain("Kael owes the Ashen Guild too.");
    const kaelReq = buildCharacterRequest(ctx, kael, modelRef);
    expect(kaelReq.system).not.toContain("SECRETS KAEL KEEPS");
  });

  it("the narrator carries the speaker law naming the cast", () => {
    const req = buildNarratorRequest(storyCtx([]), modelRef);
    expect(req.system).toContain("THE CAST'S VOICES ARE NEVER YOURS");
    expect(req.system).toContain("Mira, Kael");
    expect(req.system).toContain("An entered character takes the very next turn");
  });

  it("the narrator sees the contract, destination, and all secrets with hints", () => {
    const req = buildNarratorRequest(storyCtx([]), modelRef);
    expect(req.system).toContain("THIS SCENE'S JOB");
    expect(req.system).toContain("Entangle the user in the debt");
    expect(req.system).toContain("The scene is done when: someone commits to helping");
    expect(req.system).toContain("WHERE THE STORY IS HEADED");
    expect(req.system).toContain("Kael owes the Ashen Guild too.");
    expect(req.system).toContain("when the Guild is named to his face");
    expect(req.system).toContain("<reveal>Title</reveal>");
  });

  it("the director sees secret titles and the contract, never secret contents", () => {
    const req = buildDirectorRequest(storyCtx([]), modelRef);
    expect(req.system).toContain(`"Kael's own debt"`);
    expect(req.system).toContain("Scene goal: Entangle the user in the debt");
    expect(req.system).toContain("headed toward: Ends at dawn");
    expect(req.system).not.toContain("Kael owes the Ashen Guild too.");
  });

  it("playing a cast member anchors the narrator's camera and options to them", () => {
    const base = storyCtx([]);
    const ctx: ChatContext = {
      ...base,
      chat: { ...base.chat, personaCharacterId: "c2", characterIds: ["c1"] },
      characters: [mira],
      present: [mira],
      playedCharacter: kael,
      persona: { id: "c2", name: "Kael", description: "", tags: [], createdAt: 0, updatedAt: 0 },
    };
    const req = buildNarratorRequest(ctx, modelRef);
    expect(req.system).toContain("THE CAMERA IS KAEL");
    expect(req.system).toContain("an action or line for Kael alone");
    expect(req.system).toContain("If Kael dies or leaves the story for good");
  });
});

describe("played-character immersion helpers", () => {
  const entries = [
    { id: "s1", cast: ["lead"] },
    { id: "s2", cast: ["lead", "side"] },
    { id: "s3", cast: ["lead"] },
    { id: "s4", cast: ["side"] },
  ];

  it("entrance: first authored scene with the played character, chosen scene only if they are in it", () => {
    expect(entranceSceneId(entries, "side")).toBe("s2");
    expect(entranceSceneId(entries, "side", "s1")).toBe("s2"); // chosen without them → snap forward
    expect(entranceSceneId(entries, "side", "s4")).toBe("s4"); // chosen with them → honored
    expect(entranceSceneId(entries, "nobody")).toBeNull(); // no scene lists them → caller falls back
  });

  it("advance skips scenes the played character is not in; nothing ahead = final", () => {
    expect(nextSceneIdAfter(entries, "s2", "side")).toBe("s4"); // s3 unfolds offstage
    expect(nextSceneIdAfter(entries, "s3", "lead")).toBeNull(); // s4 excludes the lead → s3 is their finale
    expect(nextSceneIdAfter(entries, "s1", null)).toBe("s2"); // not playing a cast member → plain order
    expect(nextSceneIdAfter(entries, "missing", "side")).toBeNull();
  });
});

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
