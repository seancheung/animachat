import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildCharacterRequest,
  buildDirectorRequest,
  buildImpersonateRequest,
  buildNarratorRequest,
  computeStage,
  resolveStageAssets,
  type ChatContext,
} from "./prompts";
import { substitutePlaceholders } from "./placeholders";
import { allowedNextScenes, entranceSceneId } from "@/lib/stage";
import type { Character, Chat, Message, MessageRole, Scene, SceneEvent, StorySnapshot } from "@/lib/types";
import { DEFAULT_ALIVENESS, DEFAULT_SETTINGS } from "@/lib/types";
import type { ResolvedModel } from "./client";

// prompts.ts reads through the store — point it at a throwaway Postgres
// schema. Imports hoist above this assignment, but the store connects lazily
// on first query, so setting the env here is safe. The app runs no DDL:
// beforeAll applies migrations/*.sql into the schema, afterAll drops it.
const TEST_SCHEMA = `test_prompts_${process.pid.toString(36)}_${Date.now().toString(36)}`;
process.env.ANIMACHAT_PG_SCHEMA = TEST_SCHEMA;
import { dropTestSchema, initTestSchema } from "@/lib/testDb";
import {
  putMindState,
  putOffscreenNote,
  putRelationship,
  saveChat,
  saveCharacter,
  saveLocation,
  savePersona,
  saveScene,
} from "@/lib/store";

beforeAll(() => initTestSchema(TEST_SCHEMA));
afterAll(() => dropTestSchema(TEST_SCHEMA));

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
    aliveness: { ...DEFAULT_ALIVENESS },
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
  playAsNarrator: false,
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
  it("merges per-field with location fields winning, and strips the enabled flag", async () => {
    const loc = await saveLocation({ name: "L1", stageStyle: { enabled: true, panelBg: "#111111", accent: "#aaaaaa" } });
    const scn = await saveScene({ name: "S1", locationId: loc.id, stageStyle: { enabled: true, panelBg: "#222222", stageBg: "#000000" } });
    const st = (await resolveStageAssets(chat, stageOf(scn.id, loc.id))).stageStyle;
    expect(st).toMatchObject({ panelBg: "#111111", accent: "#aaaaaa", stageBg: "#000000" });
    expect(st).not.toHaveProperty("enabled");
  });

  it("styles are opt-in: a style without enabled: true contributes nothing", async () => {
    const loc = await saveLocation({ name: "L2", stageStyle: { panelBg: "#111111" } });
    const scn = await saveScene({ name: "S2", locationId: loc.id, stageStyle: { enabled: true, panelBg: "#222222" } });
    expect((await resolveStageAssets(chat, stageOf(scn.id, loc.id))).stageStyle?.panelBg).toBe("#222222");
  });

  it("returns null when the only style is not enabled", async () => {
    const off = await saveLocation({ name: "L3", stageStyle: { panelBg: "#111111", enabled: false } });
    expect((await resolveStageAssets(chat, stageOf(null, off.id))).stageStyle).toBeNull();
    const absent = await saveLocation({ name: "L4", stageStyle: { panelBg: "#111111" } });
    expect((await resolveStageAssets(chat, stageOf(null, absent.id))).stageStyle).toBeNull();
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
      { ...makeScene("s1", "Opening"), cast: ["c1"], goal: "", obstacles: "", exit: "", pressures: "", successors: [] },
      { ...makeScene("s2", "Finale"), cast: ["c1", "c2"], goal: "", obstacles: "", exit: "", pressures: "", successors: [] },
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

  it("opens on the first scene with its cast", async () => {
    const st = await computeStage(playChat, []);
    expect(st.sceneId).toBe("s1");
    expect(st.present).toEqual(["c1"]);
    expect(st.ended).toBe(false);
  });

  it("folds enter/leave events; a scene change resets to the new scene's cast", async () => {
    const msgs = [
      narratorEvent(0, { enter: ["c2"] }),
      narratorEvent(1, { leave: ["c1"] }),
    ];
    let st = await computeStage(playChat, msgs);
    expect(st.present).toEqual(["c2"]);
    st = await computeStage(playChat, [...msgs, narratorEvent(2, { sceneId: "s2" })]);
    expect(st.sceneId).toBe("s2");
    expect(st.present).toEqual(["c1", "c2"]);
  });

  it("never puts the played character (a non-participant) on stage", async () => {
    const asMira: Chat = { ...playChat, characterIds: ["c2"], personaCharacterId: "c1" };
    const st = await computeStage(asMira, [narratorEvent(0, { sceneId: "s2" })]);
    expect(st.present).toEqual(["c2"]);
  });

  it("derives the ended flag, and rewinding before The End un-ends the story", async () => {
    const msgs = [narratorEvent(0, { sceneId: "s2" }), narratorEvent(1, { theEnd: true })];
    expect((await computeStage(playChat, msgs)).ended).toBe(true);
    expect((await computeStage(playChat, msgs, 0)).ended).toBe(false);
  });

  it("folds reveal events, and rewinding before a reveal un-reveals it", async () => {
    const msgs = [narratorEvent(0, { enter: ["c2"] }), narratorEvent(1, { reveal: ["sec1"] })];
    expect((await computeStage(playChat, msgs)).revealed).toEqual(["sec1"]);
    expect((await computeStage(playChat, msgs, 0)).revealed).toEqual([]);
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
          ...makeScene("s1", "Opening"),
          cast: ["c1", "c2"],
          goal: "Entangle the user in the debt",
          obstacles: "Mira's pride",
          exit: "someone commits to helping",
          pressures: "",
          successors: [],
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

  it("only the holder carries an unrevealed secret; others never see it", async () => {
    const ctx = storyCtx([]);
    const kaelReq = await buildCharacterRequest(ctx, kael, modelRef);
    expect(kaelReq.system).toContain("SECRETS KAEL KEEPS");
    expect(kaelReq.system).toContain("Kael owes the Ashen Guild too.");
    const miraReq = await buildCharacterRequest(ctx, mira, modelRef);
    expect(miraReq.system).not.toContain("Kael owes the Ashen Guild too.");
  });

  it("a revealed secret becomes open truth for everyone and leaves the guarded block", async () => {
    const ctx = storyCtx(["sec1"]);
    const miraReq = await buildCharacterRequest(ctx, mira, modelRef);
    expect(miraReq.system).toContain("TRUTHS NOW IN THE OPEN");
    expect(miraReq.system).toContain("Kael owes the Ashen Guild too.");
    const kaelReq = await buildCharacterRequest(ctx, kael, modelRef);
    expect(kaelReq.system).not.toContain("SECRETS KAEL KEEPS");
  });

  it("the narrator carries the speaker law naming the cast", async () => {
    const req = await buildNarratorRequest(storyCtx([]), modelRef);
    expect(req.system).toContain("THE CAST'S VOICES ARE NEVER YOURS");
    expect(req.system).toContain("Mira, Kael");
    expect(req.system).toContain("An entered character takes the very next turn");
  });

  it("the narrator sees the contract, destination, and all secrets with hints", async () => {
    const req = await buildNarratorRequest(storyCtx([]), modelRef);
    expect(req.system).toContain("THIS SCENE'S JOB");
    expect(req.system).toContain("Entangle the user in the debt");
    expect(req.system).toContain("The scene is done when: someone commits to helping");
    expect(req.system).toContain("WHERE THE STORY IS HEADED");
    expect(req.system).toContain("Kael owes the Ashen Guild too.");
    expect(req.system).toContain("when the Guild is named to his face");
    expect(req.system).toContain("<reveal>Title</reveal>");
  });

  it("the director sees secret titles and the contract, never secret contents", async () => {
    const req = await buildDirectorRequest(storyCtx([]), modelRef);
    expect(req.system).toContain(`"Kael's own debt"`);
    expect(req.system).toContain("Scene goal: Entangle the user in the debt");
    expect(req.system).toContain("headed toward: Ends at dawn");
    expect(req.system).not.toContain("Kael owes the Ashen Guild too.");
  });

  it("playing a cast member anchors the narrator's camera and options to them", async () => {
    const base = storyCtx([]);
    const ctx: ChatContext = {
      ...base,
      chat: { ...base.chat, personaCharacterId: "c2", characterIds: ["c1"] },
      characters: [mira],
      present: [mira],
      playedCharacter: kael,
      persona: { id: "c2", name: "Kael", description: "", tags: [], createdAt: 0, updatedAt: 0 },
    };
    const req = await buildNarratorRequest(ctx, modelRef);
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
    expect(allowedNextScenes(entries, "s2", "side")).toEqual(["s4"]); // s3 unfolds offstage
    expect(allowedNextScenes(entries, "s3", "lead")).toEqual([]); // s4 excludes the lead → s3 is their finale
    expect(allowedNextScenes(entries, "s1", null)).toEqual(["s2"]); // not playing a cast member → plain order
    expect(allowedNextScenes(entries, "missing", "side")).toEqual([]);
  });
});

describe("authored branching (the roads open from a scene)", () => {
  const entries = [
    { id: "s1", cast: ["lead"] },
    {
      id: "s2",
      cast: ["lead", "side"],
      successors: [
        { sceneId: "s3a", hint: "if the debt stands" },
        { sceneId: "s3b", hint: "if the debt is settled" },
      ],
    },
    { id: "s3a", cast: ["lead"] },
    { id: "s3b", cast: ["lead", "side"] },
  ];

  it("declared successors are the open roads; a branch target with none is an ending", () => {
    expect(allowedNextScenes(entries, "s2")).toEqual(["s3a", "s3b"]);
    // s3b sits right after s3a in order, but a road is entered by its branch,
    // never by fallthrough — so both dawn scenes are endings
    expect(allowedNextScenes(entries, "s3a")).toEqual([]);
    expect(allowedNextScenes(entries, "s3b")).toEqual([]);
  });

  it("the in-order fallthrough skips branch targets", () => {
    expect(allowedNextScenes(entries, "s1")).toEqual(["s2"]);
  });

  it("a played cast member is only offered roads that include them; none left = their finale", () => {
    expect(allowedNextScenes(entries, "s2", "side")).toEqual(["s3b"]);
    const oneRoad = [entries[0], { ...entries[1], successors: [{ sceneId: "s3a", hint: "" }] }, entries[2], entries[3]];
    expect(allowedNextScenes(oneRoad, "s2", "side")).toEqual([]);
  });

  it("without branching anywhere it is exactly the plain in-order walk", () => {
    const plain = entries.map(({ id, cast }) => ({ id, cast }));
    expect(allowedNextScenes(plain, "s2")).toEqual(["s3a"]);
    expect(allowedNextScenes(plain, "s2", "side")).toEqual(["s3b"]);
    expect(allowedNextScenes(plain, "s3b")).toEqual([]);
  });

  it("ignores dangling, self and duplicate successors", () => {
    const weird = [
      {
        id: "a",
        cast: [],
        successors: [
          { sceneId: "a", hint: "" },
          { sceneId: "ghost", hint: "" },
          { sceneId: "b", hint: "" },
          { sceneId: "b", hint: "again" },
        ],
      },
      { id: "b", cast: [] },
    ];
    expect(allowedNextScenes(weird, "a")).toEqual(["b"]);
    expect(allowedNextScenes(weird, "missing")).toEqual([]);
  });
});

describe("narrator branching & offstage pressures", () => {
  const mira = makeCharacter("c1", "Mira");
  const kael = makeCharacter("c2", "Kael");

  function branchCtx(sceneId: string, playedId?: string): ChatContext {
    const scn = (id: string, name: string, setup: string): Scene => ({ ...makeScene(id, name), setup });
    const snapshot: StorySnapshot = {
      name: "Test story",
      description: "A night of debts.",
      destination: "",
      secrets: [],
      characters: [mira, kael],
      scenes: [
        {
          ...scn("s1", "The Cellar Door", "The cellar stands open."),
          cast: ["c1", "c2"],
          goal: "",
          obstacles: "",
          exit: "",
          pressures: "the collectors work their way up the river road",
          successors: [
            { sceneId: "s2a", hint: "if the debt stands" },
            { sceneId: "s2b", hint: "if the debt is settled" },
          ],
        },
        {
          ...scn("s2a", "The Collectors' Terms", "Grey gloves at the door."),
          cast: ["c1", "c2"],
          goal: "",
          obstacles: "",
          exit: "",
          pressures: "",
          successors: [],
        },
        {
          ...scn("s2b", "Nothing to Collect", "The ledger is empty."),
          cast: ["c1"],
          goal: "",
          obstacles: "",
          exit: "",
          pressures: "",
          successors: [],
        },
      ],
      locations: [],
      lorebooks: [],
    };
    const playing = !!playedId;
    const ctx = makeCtx(makeMessages(exchange("c1", 1)), playing ? [mira] : [mira, kael]);
    return {
      ...ctx,
      chat: {
        ...chat,
        mode: "story",
        narratorEnabled: true,
        storySnapshot: snapshot,
        characterIds: playing ? ["c1"] : ["c1", "c2"],
        personaCharacterId: playedId ?? null,
      },
      snapshot,
      playedCharacter: playedId ? kael : null,
      persona: playedId
        ? { id: playedId, name: "Kael", description: "", tags: [], createdAt: 0, updatedAt: 0 }
        : null,
      stage: { sceneId, locationId: null, present: ["c1"], revealed: [], ended: false },
    };
  }

  it("lists the open roads with their hints and instructs the targeted tag", async () => {
    const req = await buildNarratorRequest(branchCtx("s1"), modelRef);
    expect(req.system).toContain("WHERE THE STORY CAN GO NEXT");
    expect(req.system).toContain(`"The Collectors' Terms" — Grey gloves at the door.`);
    expect(req.system).toContain("(this road when: if the debt stands)");
    expect(req.system).toContain(`"Nothing to Collect" — The ledger is empty.`);
    expect(req.system).toContain("<next-scene>Scene Name</next-scene>");
    expect(req.system).not.toContain("this is the FINAL scene");
  });

  it("a branch-target ending offers no next scene — it is the final scene", async () => {
    const req = await buildNarratorRequest(branchCtx("s2a"), modelRef);
    expect(req.system).not.toContain("WHERE THE STORY CAN GO NEXT");
    expect(req.system).not.toContain("NEXT SCENE");
    expect(req.system).toContain("this is the FINAL scene");
  });

  it("a played cast member collapses the branch to their one road — bare tag, no menu", async () => {
    // Kael is only in s2a: the s2b road is one his story doesn't take
    const req = await buildNarratorRequest(branchCtx("s1", "c2"), modelRef);
    expect(req.system).toContain("NEXT SCENE (if the story should advance): The Collectors' Terms");
    expect(req.system).toContain("(this road when: if the debt stands)");
    expect(req.system).not.toContain("WHERE THE STORY CAN GO NEXT");
    expect(req.system).toContain("<next-scene/>");
  });

  it("carries the offstage pressure as part of the scene's job", async () => {
    const req = await buildNarratorRequest(branchCtx("s1"), modelRef);
    expect(req.system).toContain("THIS SCENE'S JOB");
    expect(req.system).toContain("Meanwhile, elsewhere: the collectors work their way up the river road");
  });
});

describe("buildCharacterRequest", () => {
  const mira = makeCharacter("c1", "Mira");

  it("includes example dialogue early in a chat", async () => {
    const ctx = makeCtx(makeMessages(exchange("c1", 2)), [mira]);
    const req = await buildCharacterRequest(ctx, mira, modelRef);
    expect(req.system).toContain("EXAMPLE OF HOW Mira SPEAKS");
  });

  it("drops example dialogue once the character has enough replies in the window", async () => {
    const ctx = makeCtx(makeMessages(exchange("c1", 8)), [mira]);
    const req = await buildCharacterRequest(ctx, mira, modelRef);
    expect(req.system).not.toContain("EXAMPLE OF HOW");
  });

  it("counts only the character's own replies toward the fade", async () => {
    const kael = makeCharacter("c2", "Kael");
    const messages = makeMessages([...exchange("c2", 10), ...exchange("c1", 2)]);
    const ctx = makeCtx(messages, [mira, kael]);
    const req = await buildCharacterRequest(ctx, mira, modelRef);
    expect(req.system).toContain("EXAMPLE OF HOW Mira SPEAKS");
    expect((await buildCharacterRequest(ctx, kael, modelRef)).system).not.toContain("EXAMPLE OF HOW");
  });

  it("binds [char_name] in a sheet to that sheet's character, not the chat's first character", async () => {
    const kael = makeCharacter("c2", "Kael");
    kael.description = "[char_name] of Varr, knight-errant.";
    const ctx = makeCtx(makeMessages(exchange("c1", 1)), [mira, kael]);
    ctx.sub = (text, selfName) =>
      substitutePlaceholders(text, { characterNames: ["Mira", "Kael"], selfName });
    const req = await buildCharacterRequest(ctx, kael, modelRef);
    expect(req.system).toContain("Kael of Varr");
    // and in Mira's prompt, Kael's sheet in OTHER CHARACTERS still resolves to Kael
    expect((await buildCharacterRequest(ctx, mira, modelRef)).system).toContain("Kael of Varr");
  });

  it("always instructs against reciting the character sheet", async () => {
    const ctx = makeCtx(makeMessages(exchange("c1", 1)), [mira]);
    const req = await buildCharacterRequest(ctx, mira, modelRef);
    expect(req.system).toContain("private background knowledge");
  });
});

describe("playing as narrator (the user is the narrator)", () => {
  const mira = makeCharacter("c1", "Mira");
  const gmCtx = (): ChatContext => ({
    ...makeCtx(makeMessages([{ role: "narrator" }, { role: "character", characterId: "c1" }]), [mira]),
    chat: { ...chat, playAsNarrator: true, narratorEnabled: false },
  });

  it("frames the user as the narrator and pins third person in character prompts", async () => {
    const req = await buildCharacterRequest(gmCtx(), mira, modelRef);
    expect(req.system).toContain("THE USER IS THE NARRATOR");
    expect(req.system).toContain("third person");
    // the persona-mode user-format rule is replaced, not merely appended to
    expect(req.system).not.toContain("their unmarked text is usually speech");
  });

  it("impersonate drafts narration, with narrator messages as the user's own side", async () => {
    const req = await buildImpersonateRequest(gmCtx(), modelRef);
    expect(req.system).toContain("NARRATION");
    expect(req.system).toContain("Never write the characters' dialogue");
    // the narrator-role message is the user's own → assistant side of the history
    expect(req.messages.some((m) => m.role === "assistant" && m.content.includes("message 0"))).toBe(true);
  });
});

describe("impersonate POV (a draft on the user's behalf gets the user's seat, not a speaker's)", () => {
  const mira = makeCharacter("c1", "Mira");
  const povCtx = (pov: ChatContext["pov"]): ChatContext => ({
    ...makeCtx(makeMessages(exchange("c1", 2)), [mira]),
    pov,
    persona: { id: "p1", name: "Ash", description: "A wandering scribe.", tags: [], createdAt: 0, updatedAt: 0 },
  });

  it("vn2nd: drafts in the user's first person, never the narrator's second person", async () => {
    const req = await buildImpersonateRequest(povCtx("vn2nd"), modelRef);
    expect(req.system).not.toContain('Address the user directly as "you"');
    expect(req.system).toContain('write in first person as Ash ("I ...")');
    expect(req.system).toContain("Never write in second person");
  });

  it("user1st: the draft speaks as I, not about Ash from outside", async () => {
    const req = await buildImpersonateRequest(povCtx("user1st"), modelRef);
    expect(req.system).toContain('Write in first person as Ash ("I ...")');
    expect(req.system).not.toContain("Refer to the user as Ash");
  });

  it("third: the draft stays in third person by name", async () => {
    const req = await buildImpersonateRequest(povCtx("third"), modelRef);
    expect(req.system).toContain(`write Ash's actions and dialogue by name`);
  });

  it("character prompts keep the speaker-seat rules", async () => {
    const req = await buildCharacterRequest(povCtx("vn2nd"), mira, modelRef);
    expect(req.system).toContain('Address the user directly as "you"');
  });

  it("narrator options carry the user-seat convention next to the speaker-seat narration rules", async () => {
    const req = await buildNarratorRequest({ ...povCtx("vn2nd"), chat: { ...chat, narratorEnabled: true } }, modelRef);
    // the narration itself keeps the speaker seat…
    expect(req.system).toContain('Address the user directly as "you"');
    // …while the suggested actions get the user's format and POV explicitly
    expect(req.system).toContain("Format each like the user's messages, not like your narration: actions in *asterisks*");
    expect(req.system).toContain('write in first person as Ash ("I ...")');
  });
});

describe("aliveness prompt gates", () => {
  const HOUR = 60 * 60 * 1000;
  // mind states / offscreen notes / relationships live behind foreign keys — these
  // tests need real rows, not the in-memory fixtures. Traits are opted in here:
  // aliveness is all-off by default.
  let dbChar: Character;
  let dbChat: Chat;
  beforeAll(async () => {
    dbChar = await saveCharacter({
      name: "Vale",
      aliveness: { initiative: true, timeAware: true, mindState: true, offscreenLife: "off" },
    });
    dbChat = await saveChat({ title: "aliveness", characterIds: [dbChar.id] });
  });
  const at = (ts: number) => (m: Message, i: number, all: Message[]) => ({
    ...m,
    createdAt: ts + i - all.length,
  });
  const ctxFor = (
    character: Character,
    opts: { msgAt?: number; snapshot?: boolean } = {}
  ): ChatContext => {
    const messages = makeMessages(exchange(character.id, 2)).map(at(opts.msgAt ?? Date.now()));
    const base = makeCtx(messages, [character]);
    return {
      ...base,
      chat: { ...chat, id: dbChat.id },
      snapshot: opts.snapshot
        ? { name: "S", description: "", destination: "", secrets: [], characters: [character], scenes: [], locations: [], lorebooks: [] }
        : null,
    };
  };

  it("initiative block rides its toggle, and defaults to off", async () => {
    expect((await buildCharacterRequest(ctxFor(dbChar), dbChar, modelRef)).system).toContain("HAS A LIFE OF THEIR OWN");
    const quiet = { ...dbChar, aliveness: { ...dbChar.aliveness, initiative: false } };
    expect((await buildCharacterRequest(ctxFor(quiet), quiet, modelRef)).system).not.toContain("HAS A LIFE OF THEIR OWN");
    // a character that never opted in stays purely reactive
    const plain = { ...dbChar, aliveness: { ...DEFAULT_ALIVENESS } };
    expect((await buildCharacterRequest(ctxFor(plain), plain, modelRef)).system).not.toContain("HAS A LIFE OF THEIR OWN");
  });

  it("story mode suppresses every aliveness block regardless of toggles", async () => {
    await putMindState(dbChar.id, dbChat.id, "restless");
    const req = await buildCharacterRequest(ctxFor(dbChar, { snapshot: true, msgAt: Date.now() - 8 * HOUR }), dbChar, modelRef);
    expect(req.system).not.toContain("HAS A LIFE OF THEIR OWN");
    expect(req.system).not.toContain("ON VALE'S MIND");
    expect(req.system).not.toContain("TIME: about");
  });

  it("a real gap surfaces as a TIME note only when time awareness is on", async () => {
    const old = { msgAt: Date.now() - 30 * HOUR };
    expect((await buildCharacterRequest(ctxFor(dbChar, old), dbChar, modelRef)).system).toContain("TIME: about 30 hours");
    expect((await buildCharacterRequest(ctxFor(dbChar), dbChar, modelRef)).system).not.toContain("TIME: about");
    const timeless = { ...dbChar, aliveness: { ...dbChar.aliveness, timeAware: false } };
    expect((await buildCharacterRequest(ctxFor(timeless, old), timeless, modelRef)).system).not.toContain("TIME: about");
  });

  it("mind state and off-screen notes inject from the store behind their gates", async () => {
    await putMindState(dbChar.id, dbChat.id, "still turning the argument over");
    await putOffscreenNote(dbChar.id, dbChat.id, "has been repainting the shop");
    const req = await buildCharacterRequest(ctxFor(dbChar), dbChar, modelRef);
    expect(req.system).toContain("still turning the argument over");
    // offscreenLife defaults to off — the stored note must NOT leak in
    expect(req.system).not.toContain("repainting the shop");
    const texter = { ...dbChar, aliveness: { ...dbChar.aliveness, offscreenLife: "texts" as const } };
    expect((await buildCharacterRequest(ctxFor(texter), texter, modelRef)).system).toContain("repainting the shop");
  });

  it("a returning turn instructs the character to re-open the conversation", async () => {
    const req = await buildCharacterRequest(ctxFor(dbChar), dbChar, modelRef, { returning: true });
    expect(req.system).toContain("re-opening the conversation");
    expect((await buildCharacterRequest(ctxFor(dbChar), dbChar, modelRef)).system).not.toContain("re-opening the conversation");
  });

  it("relationship lines carry an affinity tone reading", async () => {
    const persona = await savePersona({ name: "Rin" });
    await putRelationship(dbChar.id, persona.id, 70, "shared a rooftop dinner");
    const ctx = { ...ctxFor(dbChar), persona };
    const req = await buildCharacterRequest(ctx, dbChar, modelRef);
    expect(req.system).toContain("affinity 70/100 (close and at ease)");
    expect(req.system).toContain("let the affinity color tone and openness");
  });
});
