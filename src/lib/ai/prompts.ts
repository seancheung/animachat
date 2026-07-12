import { estimateTokens, type LlmMessage, type ResolvedModel } from "./client";
import { substitutePlaceholders } from "./placeholders";
import {
  getChat,
  getCharacter,
  getCharRelationship,
  getLocation,
  getLorebook,
  getPersona,
  getRelationship,
  getScene,
  getSettings,
  getSummary,
  listFacts,
  listMessages,
} from "@/lib/store";
import type {
  Chat,
  Character,
  CharRelationship,
  Location,
  Lorebook,
  Message,
  Persona,
  Pov,
  Scene,
  Settings,
  StageStyle,
  StorySnapshot,
} from "@/lib/types";
import { EMOTIONS } from "@/lib/types";

/* ---------------- stage state (derived from the message timeline) ---------------- */

export interface StageState {
  sceneId: string | null;
  locationId: string | null;
  /** story mode: character ids on stage (never includes the played character); null = everyone (casual/immersive) */
  present: string[] | null;
  /** story mode: the playthrough has concluded (<the-end/>) */
  ended: boolean;
}

/** Playthroughs resolve scenes/locations from their frozen snapshot, never the library. */
export function chatScene(chat: Chat, id: string | null | undefined): Scene | null {
  if (!id) return null;
  return chat.storySnapshot?.scenes.find((s) => s.scene.id === id)?.scene ?? getScene(id);
}

export function chatLocation(chat: Chat, id: string | null | undefined): Location | null {
  if (!id) return null;
  return chat.storySnapshot?.locations.find((l) => l.id === id) ?? getLocation(id);
}

/** Walk the timeline accumulating stage events; never a free-floating field. */
export function computeStage(chat: Chat, messages: Message[], uptoPosition?: number): StageState {
  const snap = chat.mode === "story" ? chat.storySnapshot : null;
  const participants = new Set(chat.characterIds);
  // a scene opens with its snapshot cast (minus the played character = the participants filter)
  const castOf = (sceneId: string | null): string[] | null => {
    if (!snap) return null;
    const entry = snap.scenes.find((s) => s.scene.id === sceneId);
    return (entry?.cast ?? []).filter((id) => participants.has(id));
  };
  const startSceneId = chat.sceneId ?? snap?.scenes[0]?.scene.id ?? null;
  const state: StageState = {
    sceneId: startSceneId,
    locationId: chat.locationId ?? chatScene(chat, startSceneId)?.locationId ?? null,
    present: castOf(startSceneId),
    ended: false,
  };
  for (const m of messages) {
    if (uptoPosition !== undefined && m.position > uptoPosition) break;
    const ev = m.sceneEvent;
    if (!ev) continue;
    if (ev.sceneId) {
      state.sceneId = ev.sceneId;
      state.locationId = chatScene(chat, ev.sceneId)?.locationId ?? null;
      state.present = castOf(ev.sceneId);
    }
    if (state.present && (ev.enter?.length || ev.leave?.length)) {
      const cur = new Set(state.present);
      for (const id of ev.enter ?? []) if (participants.has(id)) cur.add(id);
      for (const id of ev.leave ?? []) cur.delete(id);
      state.present = [...cur];
    }
    if (ev.theEnd) state.ended = true;
  }
  return state;
}

export interface StageAssets {
  scene: Scene | null;
  location: Location | null;
  artworkAsset: string | null;
  bgmAsset: string | null;
  ambientAsset: string | null;
  stageStyle: StageStyle | null;
}

/** Location assets win when present; otherwise the scene's own. Style fields resolve the same way. */
export function resolveStageAssets(chat: Chat, state: StageState): StageAssets {
  const scene = chatScene(chat, state.sceneId);
  const location = chatLocation(chat, state.locationId);
  // per-field precedence: the location's set fields win, the scene's fill the rest;
  // styles are opt-in — only an explicitly enabled one contributes
  const active = (st: StageStyle | null | undefined) => (st?.enabled === true ? st : null);
  const style: StageStyle = {
    ...(active(scene?.stageStyle) ?? {}),
    ...Object.fromEntries(Object.entries(active(location?.stageStyle) ?? {}).filter(([, v]) => v != null)),
  };
  delete style.enabled;
  return {
    scene,
    location,
    artworkAsset: location?.artworkAsset ?? scene?.artworkAsset ?? null,
    bgmAsset: location?.bgmAsset ?? scene?.bgmAsset ?? null,
    ambientAsset: location?.ambientAsset ?? scene?.ambientAsset ?? null,
    stageStyle: Object.values(style).some((v) => v != null) ? style : null,
  };
}

/* ---------------- shared chat context ---------------- */

export interface ChatContext {
  chat: Chat;
  settings: Settings;
  language: string;
  pov: Pov;
  /** all AI participants (playthroughs: roster minus the played character, from the snapshot) */
  characters: Character[];
  /** participants currently on stage — equals `characters` outside story mode */
  present: Character[];
  persona: Persona | null;
  /** story mode: the roster member the user plays as (their full snapshot sheet) */
  playedCharacter: Character | null;
  /** story mode: the frozen story bundle */
  snapshot: StorySnapshot | null;
  stage: StageState;
  scene: Scene | null;
  location: Location | null;
  /** story mode: the playthrough has concluded */
  ended: boolean;
  lorebooks: Lorebook[];
  messages: Message[];
  summaryText: string;
  summaryCovered: number;
  contextBudget: (model: ResolvedModel) => number;
  verbatimShare: number;
  chunkThreshold: number;
  /** substitute [char_name]-style placeholder tags with this chat's values;
   *  pass selfName when substituting a character's own sheet so [char_name] means them */
  sub: (text: string, selfName?: string) => string;
}

/** Pass messagesOverride to build the context as of a truncated timeline (regeneration):
 *  stage state, presence and the ended flag are all derived from the given messages. */
export function buildContext(chatId: string, messagesOverride?: Message[]): ChatContext {
  const chat = getChat(chatId);
  if (!chat) throw new Error("Chat not found");
  const settings = getSettings();
  const messages = messagesOverride ?? listMessages(chatId);
  const stage = computeStage(chat, messages);
  const summary = getSummary(chatId);
  const snapshot = chat.mode === "story" ? chat.storySnapshot : null;
  const characters = snapshot
    ? chat.characterIds
        .map((id) => snapshot.characters.find((c) => c.id === id))
        .filter((c): c is Character => !!c)
    : chat.characterIds.map(getCharacter).filter((c): c is Character => !!c);
  const playedCharacter =
    (chat.personaCharacterId && snapshot?.characters.find((c) => c.id === chat.personaCharacterId)) || null;
  // playing a roster member: their sheet doubles as the persona
  const persona: Persona | null = playedCharacter
    ? {
        id: playedCharacter.id,
        name: playedCharacter.name,
        description: playedCharacter.description,
        createdAt: playedCharacter.createdAt,
        updatedAt: playedCharacter.updatedAt,
      }
    : chat.personaId
      ? getPersona(chat.personaId)
      : null;
  const present = stage.present ? characters.filter((c) => stage.present!.includes(c.id)) : characters;
  const scene = chatScene(chat, stage.sceneId);
  const location = chatLocation(chat, stage.locationId);
  return {
    chat,
    settings,
    language: chat.language || settings.language,
    pov: (chat.pov || settings.pov) as Pov,
    characters,
    present,
    persona,
    playedCharacter,
    snapshot,
    stage,
    scene,
    location,
    ended: stage.ended,
    lorebooks: snapshot
      ? snapshot.lorebooks
      : chat.lorebookIds.map(getLorebook).filter((l): l is Lorebook => !!l),
    messages,
    summaryText: summary.content,
    summaryCovered: summary.coveredPosition,
    sub: (text: string, selfName?: string) =>
      substitutePlaceholders(text, {
        characterNames: characters.map((c) => c.name),
        selfName,
        userName: persona?.name,
        locationName: location?.name,
        sceneName: scene?.name,
        storyName: snapshot?.name,
      }),
    contextBudget: (model) =>
      chat.overrides.contextBudget ??
      Math.min(settings.contextBudgetCap, model.model.contextWindow - settings.outputReserve),
    verbatimShare: chat.overrides.verbatimShare ?? settings.verbatimShare,
    chunkThreshold: chat.overrides.chunkThreshold ?? settings.chunkThreshold,
  };
}

/* ---------------- helpers ---------------- */

export function activeContent(m: Message): string {
  return m.variants[m.activeVariant]?.content ?? "";
}

export function activeEmotion(m: Message): string | null {
  return m.variants[m.activeVariant]?.emotion ?? null;
}

export function speakerName(ctx: ChatContext, m: Message): string {
  if (m.role === "user") return ctx.persona?.name ?? "User";
  if (m.role === "narrator") return "Narrator";
  if (m.role === "character") {
    return (
      ctx.characters.find((c) => c.id === m.characterId)?.name ??
      getCharacter(m.characterId ?? "")?.name ??
      ctx.chat.nameSnapshots[m.characterId ?? ""] ??
      "???"
    );
  }
  return "";
}

function renderMessageLine(ctx: ChatContext, m: Message): string | null {
  if (m.role === "marker") return null; // legacy role — nothing creates markers anymore
  const content = activeContent(m);
  if (!content) return null;
  return `${speakerName(ctx, m)}: ${content}`;
}

/** Select the recent messages that fit the verbatim window budget. */
export function verbatimWindow(ctx: ChatContext, model: ResolvedModel): Message[] {
  const budget = Math.max(1000, ctx.contextBudget(model) * ctx.verbatimShare);
  const out: Message[] = [];
  let used = 0;
  for (let i = ctx.messages.length - 1; i >= 0; i--) {
    const m = ctx.messages[i];
    const cost = estimateTokens(activeContent(m)) + 8;
    if (out.length > 0 && used + cost > budget) break;
    out.unshift(m);
    used += cost;
  }
  return out;
}

/** Lorebook entries triggered by keywords in recent context. */
export function triggeredLore(ctx: ChatContext, recent: Message[], extraText = ""): string[] {
  const hits: string[] = [];
  for (const book of ctx.lorebooks) {
    for (const entry of book.entries) {
      const depth = entry.scanDepth || 8;
      const haystack = (
        recent
          .slice(-depth)
          .map((m) => activeContent(m))
          .join("\n") +
        "\n" +
        extraText
      ).toLowerCase();
      if (entry.keywords.some((k) => k.trim() && haystack.includes(k.trim().toLowerCase()))) {
        hits.push(ctx.sub(`${entry.title}: ${entry.content}`));
      }
    }
  }
  return hits;
}

function povRules(pov: Pov, personaName: string, selfName: string | null): string {
  switch (pov) {
    case "user1st":
      return `${personaName} (the user) writes in first person ("I ..."). ${
        selfName ? `Write ${selfName}'s actions and dialogue in third person.` : "Write characters in third person."
      } Refer to the user as ${personaName}.`;
    case "third":
      return `Everyone writes in third person, like co-authoring a novel. Refer to the user's character as ${personaName}.`;
    case "vn2nd":
      return `Address the user directly as "you", visual-novel style. Describe what "you" see, hear and feel. The user writes in first person.`;
  }
}

function worldBlock(ctx: ChatContext): string {
  const parts: string[] = [];
  if (ctx.snapshot) {
    const sceneNames = ctx.snapshot.scenes.map(({ scene }, i) => {
      const marker = scene.id === ctx.stage.sceneId ? " <- current scene" : "";
      return `  ${i + 1}. ${scene.name}${marker}`;
    });
    parts.push(`STORY: ${ctx.snapshot.name}\n${ctx.snapshot.description}\nScenes:\n${sceneNames.join("\n")}`);
  }
  if (ctx.scene) parts.push(`CURRENT SCENE: ${ctx.scene.name}\n${ctx.scene.setup}`);
  if (ctx.location) parts.push(`LOCATION: ${ctx.location.name}\n${ctx.location.description}`);
  if (ctx.ended) parts.push(`THE STORY HAS CONCLUDED. What follows is a free-form epilogue.`);
  return ctx.sub(parts.join("\n\n"));
}

function personaBlock(ctx: ChatContext): string {
  if (!ctx.persona) return "";
  const label = ctx.playedCharacter
    ? `THE USER'S CHARACTER (the user plays ${ctx.persona.name}, a member of the story's cast)`
    : `THE USER'S CHARACTER (persona)`;
  return `${label}: ${ctx.persona.name}\n${ctx.sub(ctx.persona.description)}`;
}

function formatRules(ctx: ChatContext, selfName: string | null): string {
  return [
    `Write in ${ctx.language}.`,
    `FORMAT: spoken words go in "double quotes"; physical actions and descriptions go in *asterisks*; ` +
      `anything else reads as narration. The user's messages follow the same convention — their quoted text ` +
      `is what they said aloud, their *asterisks* are what they did.`,
    povRules(ctx.pov, ctx.persona?.name ?? "the user", selfName),
  ].join("\n");
}

/**
 * Convert history into alternating LlmMessages from the point of view of one speaker
 * ("assistant" = that speaker's own messages). Merges consecutive same-role turns.
 */
export function historyAsMessages(
  ctx: ChatContext,
  window: Message[],
  isSelf: (m: Message) => boolean,
  selfEmotionTags: boolean
): LlmMessage[] {
  const out: LlmMessage[] = [];
  const push = (role: "user" | "assistant", content: string) => {
    if (!content) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += "\n\n" + content;
    else out.push({ role, content });
  };
  for (const m of window) {
    if (isSelf(m) && m.role !== "marker") {
      const emo = activeEmotion(m);
      push("assistant", (selfEmotionTags && emo ? `<emo>${emo}</emo>` : "") + activeContent(m));
    } else {
      const line = renderMessageLine(ctx, m);
      if (line) push("user", line);
    }
  }
  if (out.length === 0 || out[0].role === "assistant") {
    out.unshift({ role: "user", content: "[The roleplay begins.]" });
  }
  if (out[out.length - 1].role === "assistant") {
    out.push({ role: "user", content: "[Continue.]" });
  }
  return out;
}

/* ---------------- request builders ---------------- */

export interface BuiltRequest {
  system: string;
  messages: LlmMessage[];
}

/** Own replies in the verbatim window before example dialogue drops out of the prompt. */
const EXAMPLE_DIALOGUE_FADE = 8;

export function buildCharacterRequest(ctx: ChatContext, character: Character, model: ResolvedModel): BuiltRequest {
  const window = verbatimWindow(ctx, model);
  const lore = triggeredLore(ctx, window);
  // example dialogue seeds the voice early on; once the character has real replies
  // in the window those anchor the style, and the static example only invites copying
  const ownReplies = window.filter(
    (m) => m.role === "character" && m.characterId === character.id
  ).length;
  const facts = listFacts(character.id, 50);
  // playing a cast member: the "user relationship" is really character↔character
  const rel =
    ctx.persona && ctx.settings.userRelationshipsEnabled && character.trackRelationship
      ? ctx.playedCharacter
        ? getCharRelationship(character.id, ctx.playedCharacter.id)
        : getRelationship(character.id, ctx.persona.id)
      : null;
  const others = ctx.present.filter((c) => c.id !== character.id);
  // this character's view of the other characters present (global switch + both sides' tracking)
  const charRels =
    ctx.settings.charRelationshipsEnabled && character.trackRelationship
      ? others
        .filter((o) => o.trackRelationship)
        .map((o) => ({ other: o, rel: getCharRelationship(character.id, o.id) }))
        .filter((x): x is { other: Character; rel: CharRelationship } => !!x.rel)
    : [];

  const emotions = [
    ...EMOTIONS,
    ...character.customExpressions.map((e) => `${e.name} (${ctx.sub(e.description, character.name)})`),
  ].join(", ");

  const system = [
    `You are ${character.name}, a character in an ongoing roleplay chat. Stay in character at all times.`,
    `ABOUT ${character.name.toUpperCase()}:\n${ctx.sub(character.description, character.name)}`,
    character.exampleDialogue && ownReplies < EXAMPLE_DIALOGUE_FADE
      ? `EXAMPLE OF HOW ${character.name} SPEAKS:\n${ctx.sub(character.exampleDialogue, character.name)}`
      : "",
    others.length
      ? `OTHER CHARACTERS PRESENT: ${others.map((c) => `${c.name} — ${ctx.sub(c.description, c.name).slice(0, 200)}`).join("; ")}`
      : "",
    worldBlock(ctx),
    personaBlock(ctx),
    rel || charRels.length
      ? `RELATIONSHIPS (${character.name}'s own view):\n` +
        [
          rel ? `- with ${ctx.persona?.name}: affinity ${rel.affinity}/100.${rel.notes ? ` ${rel.notes}` : ""}` : "",
          ...charRels.map(
            ({ other, rel: r }) => `- with ${other.name}: affinity ${r.affinity}/100.${r.notes ? ` ${r.notes}` : ""}`
          ),
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    facts.length
      ? `THINGS ${character.name.toUpperCase()} REMEMBERS (long-term memory):\n${facts
          .map((f) => `- ${f.content}`)
          .join("\n")}`
      : "",
    ctx.summaryText ? `SUMMARY OF EARLIER CONVERSATION:\n${ctx.summaryText}` : "",
    lore.length ? `WORLD KNOWLEDGE (relevant lore):\n${lore.map((l) => `- ${l}`).join("\n")}` : "",
    `RULES:\n${formatRules(ctx, character.name)}\n` +
      `Speak and act ONLY as ${character.name}. Never write the user's actions, dialogue or decisions.\n` +
      `Your character sheet is private background knowledge, not content: never quote, paraphrase or re-announce your own traits, backstory or appearance — reveal them through how you act and speak, and only when the scene calls for them. Don't reuse distinctive phrases from your earlier messages.\n` +
      (others.length
        ? `You may hand the conversation to another character by addressing them as @Name in your reply — they will respond next. Do it only when the scene calls for it.\n`
        : "") +
      `Begin your reply with an emotion tag <emo>name</emo> — pick the emotion that best matches the message from: ${emotions}. ` +
      `The tag is descriptive metadata about your message, NOT a constraint: write whatever emotion the moment truly calls for, then label it. After the tag, write only prose.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    system,
    messages: historyAsMessages(ctx, window, (m) => m.role === "character" && m.characterId === character.id, true),
  };
}

export function buildNarratorRequest(ctx: ChatContext, model: ResolvedModel): BuiltRequest {
  const window = verbatimWindow(ctx, model);
  const lore = triggeredLore(ctx, window);

  // story mode: where we are in the scene sequence, and who is on/off stage
  let nextSceneInfo = "";
  let finalScene = false;
  if (ctx.snapshot && ctx.stage.sceneId && !ctx.ended) {
    const idx = ctx.snapshot.scenes.findIndex((s) => s.scene.id === ctx.stage.sceneId);
    finalScene = idx === ctx.snapshot.scenes.length - 1;
    if (idx !== -1 && !finalScene) {
      const next = ctx.snapshot.scenes[idx + 1].scene;
      nextSceneInfo = ctx.sub(`NEXT SCENE (if the story should advance): ${next.name} — ${next.setup}`);
    }
  }
  const offStage = ctx.snapshot ? ctx.characters.filter((c) => !ctx.present.some((p) => p.id === c.id)) : [];
  const castBlock = ctx.snapshot
    ? `CAST ON STAGE: ${ctx.present.map((c) => c.name).join(", ") || "(nobody)"}` +
      (offStage.length ? `\nCAST OFF STAGE (can be brought in): ${offStage.map((c) => c.name).join(", ")}` : "")
    : "";

  const stagingRules =
    ctx.snapshot && !ctx.ended
      ? `You direct the stage. To bring a cast member on, append <enter>Name</enter>; to send one off, append <leave>Name</leave> — always also describing the arrival or departure in the narration itself. Only cast members listed above can enter.\n` +
        (nextSceneInfo
          ? `If the current scene has clearly run its course, move the story to the next scene: write the transition and append <next-scene/> on its own line.\n`
          : "") +
        `When the story reaches its natural resolution${finalScene ? " (this is the FINAL scene — <next-scene/> is not available)" : ""}, conclude it: write the closing narration and append <the-end/> on its own line. A concluding message needs no suggested actions.\n`
      : "";

  const system = [
    `You are the NARRATOR of an ongoing roleplay. You describe scenery, atmosphere, events and transitions; you move the plot forward. You never speak or decide for the characters or the user.`,
    `CHARACTERS: ${ctx.characters.map((c) => `${c.name} — ${ctx.sub(c.description, c.name).slice(0, 200)}`).join("; ")}`,
    castBlock,
    worldBlock(ctx),
    personaBlock(ctx),
    nextSceneInfo,
    ctx.summaryText ? `SUMMARY OF EARLIER CONVERSATION:\n${ctx.summaryText}` : "",
    lore.length ? `WORLD KNOWLEDGE (relevant lore):\n${lore.map((l) => `- ${l}`).join("\n")}` : "",
    `RULES:\n${formatRules(ctx, null)}\n` +
      (ctx.ended
        ? `The story has concluded — narrate a gentle epilogue moment (2-4 sentences). No tags of any kind.`
        : `Write a short narration (2-5 sentences) that helps the plot proceed. Narration is all description — asterisks are optional for you.\n` +
          stagingRules +
          `Unless you are concluding the story, ALWAYS end with 2-4 suggested actions the user could take next, formatted exactly as:\n` +
          `<options><o>first suggestion</o><o>second suggestion</o></options>\n` +
          `Each suggestion is written as the user's own message (matching the point-of-view rules above), ready to send as-is — ` +
            `in the same format convention: a thing the user DOES goes in *asterisks*, a thing they SAY in "double quotes". ` +
            `Suggestions are sent verbatim, so an unmarked one would be taken as spoken words.`),
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    system,
    messages: historyAsMessages(ctx, window, (m) => m.role === "narrator", false),
  };
}

export function buildOrchestratorRequest(ctx: ChatContext, model: ResolvedModel): BuiltRequest {
  const window = verbatimWindow(ctx, model).slice(-12);
  const transcript = window
    .map((m) => renderMessageLine(ctx, m) ?? "")
    .filter(Boolean)
    .join("\n");
  const candidates = ctx.present.map((c) => `"${c.id}" = ${c.name}`);
  if (ctx.chat.narratorEnabled) candidates.push(`"narrator" = the scene narrator`);
  const system =
    `You direct a roleplay chat. Given the recent transcript, decide who should respond next.\n` +
    `Candidates:\n${candidates.join("\n")}\n` +
    `Rules: prefer a character who was directly addressed or has the most natural reaction. ` +
    `Pick "narrator" only when narration would genuinely help (scene-setting, a lull, a transition).` +
    ` Respond with ONLY a JSON object: {"next": "<candidate id>"}`;
  return { system, messages: [{ role: "user", content: `Transcript:\n${transcript}\n\nWho responds next?` }] };
}

/** Resolve @mentions in a message to character ids (partial names & nicknames allowed). */
export function buildMentionResolveRequest(
  ctx: ChatContext,
  text: string,
  author?: Character | null
): BuiltRequest {
  const candidates = ctx.present.map((c) => `"${c.id}" = ${c.name}`).join("\n");
  const system =
    `You route a group roleplay chat. A message addresses one or more characters with @mentions — ` +
    `partial names and nicknames count, as long as it is clear who is meant.\n` +
    `Characters:\n${candidates}\n` +
    (ctx.persona ? `"${ctx.persona.name}" is the user, not a character — ignore mentions of the user.\n` : "") +
    (author ? `The message was written by ${author.name} — ignore mentions of ${author.name} themselves.\n` : "") +
    `Respond with ONLY a JSON object listing who should reply, in reply order: {"speakers": ["<character id>", ...]}. ` +
    `Omit mentions that match no character. If no mention clearly matches anyone, respond {"speakers": []}.`;
  return { system, messages: [{ role: "user", content: `Message:\n${text}\n\nWho is addressed?` }] };
}

export function buildImpersonateRequest(ctx: ChatContext, model: ResolvedModel): BuiltRequest {
  const window = verbatimWindow(ctx, model);
  const system = [
    `You write the next message ON BEHALF OF THE USER in a roleplay chat.`,
    personaBlock(ctx),
    worldBlock(ctx),
    ctx.summaryText ? `SUMMARY OF EARLIER CONVERSATION:\n${ctx.summaryText}` : "",
    `RULES:\n${formatRules(ctx, null)}\n` +
      `Write 1-3 sentences as ${ctx.persona?.name ?? "the user"} — their voice, their perspective. Plain prose only: no emotion tags, no options, no name prefix.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    system,
    messages: historyAsMessages(ctx, window, (m) => m.role === "user", false),
  };
}

export function buildTitleRequest(ctx: ChatContext): BuiltRequest {
  const transcript = ctx.messages
    .slice(0, 6)
    .map((m) => renderMessageLine(ctx, m) ?? "")
    .filter(Boolean)
    .join("\n");
  return {
    system: `Generate a short evocative title (max 6 words) for this roleplay chat, in ${ctx.language}. Respond with the title only — no quotes, no punctuation around it.`,
    messages: [{ role: "user", content: transcript || "An empty chat." }],
  };
}
