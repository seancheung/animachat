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
  getStory,
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
  Story,
} from "@/lib/types";
import { EMOTIONS } from "@/lib/types";

/* ---------------- stage state (derived from the message timeline) ---------------- */

export interface StageState {
  sceneId: string | null;
  locationId: string | null;
}

/** Walk the timeline accumulating scene-change events; never a free-floating field. */
export function computeStage(chat: Chat, messages: Message[], uptoPosition?: number): StageState {
  let sceneId = chat.sceneId;
  if (!sceneId && chat.storyId) {
    const story = getStory(chat.storyId);
    sceneId = story?.sceneIds[0] ?? null;
  }
  const scene = sceneId ? getScene(sceneId) : null;
  const state: StageState = {
    sceneId,
    locationId: chat.locationId ?? scene?.locationId ?? null,
  };
  for (const m of messages) {
    if (uptoPosition !== undefined && m.position > uptoPosition) break;
    const ev = m.sceneEvent;
    if (!ev) continue;
    if (ev.kind === "scene") {
      state.sceneId = ev.sceneId ?? null;
      state.locationId = ev.locationId ?? (ev.sceneId ? getScene(ev.sceneId)?.locationId ?? null : null);
    } else if (ev.kind === "location") {
      state.locationId = ev.locationId ?? null;
    }
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
export function resolveStageAssets(state: StageState): StageAssets {
  const scene = state.sceneId ? getScene(state.sceneId) : null;
  const location = state.locationId ? getLocation(state.locationId) : null;
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
  characters: Character[];
  persona: Persona | null;
  story: Story | null;
  stage: StageState;
  scene: Scene | null;
  location: Location | null;
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

export function buildContext(chatId: string): ChatContext {
  const chat = getChat(chatId);
  if (!chat) throw new Error("Chat not found");
  const settings = getSettings();
  const messages = listMessages(chatId);
  const stage = computeStage(chat, messages);
  const summary = getSummary(chatId);
  const characters = chat.characterIds.map(getCharacter).filter((c): c is Character => !!c);
  const persona = chat.personaId ? getPersona(chat.personaId) : null;
  const story = chat.storyId ? getStory(chat.storyId) : null;
  const scene = stage.sceneId ? getScene(stage.sceneId) : null;
  const location = stage.locationId ? getLocation(stage.locationId) : null;
  return {
    chat,
    settings,
    language: chat.language || settings.language,
    pov: (chat.pov || settings.pov) as Pov,
    characters,
    persona,
    story,
    stage,
    scene,
    location,
    lorebooks: chat.lorebookIds.map(getLorebook).filter((l): l is Lorebook => !!l),
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
        storyName: story?.name,
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
    return ctx.characters.find((c) => c.id === m.characterId)?.name ?? getCharacter(m.characterId ?? "")?.name ?? "???";
  }
  return "";
}

function renderMessageLine(ctx: ChatContext, m: Message): string | null {
  if (m.role === "marker") {
    if (!m.sceneEvent) return null;
    if (m.sceneEvent.kind === "scene") {
      const s = m.sceneEvent.sceneId ? getScene(m.sceneEvent.sceneId) : null;
      return ctx.sub(`[The scene changes to: ${s?.name ?? "a new scene"}. ${s?.setup ?? ""}]`);
    }
    const l = m.sceneEvent.locationId ? getLocation(m.sceneEvent.locationId) : null;
    return `[The setting moves to: ${l?.name ?? "a new place"}.]`;
  }
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
  if (ctx.story) {
    const sceneNames = ctx.story.sceneIds.map((id, i) => {
      const s = getScene(id);
      const marker = id === ctx.stage.sceneId ? " <- current scene" : "";
      return `  ${i + 1}. ${s?.name ?? "?"}${marker}`;
    });
    parts.push(`STORY: ${ctx.story.name}\n${ctx.story.description}\nScenes:\n${sceneNames.join("\n")}`);
  }
  if (ctx.scene) parts.push(`CURRENT SCENE: ${ctx.scene.name}\n${ctx.scene.setup}`);
  if (ctx.location) parts.push(`LOCATION: ${ctx.location.name}\n${ctx.location.description}`);
  return ctx.sub(parts.join("\n\n"));
}

function personaBlock(ctx: ChatContext): string {
  if (!ctx.persona) return "";
  return `THE USER'S CHARACTER (persona): ${ctx.persona.name}\n${ctx.sub(ctx.persona.description)}`;
}

function formatRules(ctx: ChatContext, selfName: string | null): string {
  return [
    `Write in ${ctx.language}.`,
    `Format: physical actions and descriptions go in *asterisks*, spoken dialogue in "double quotes".`,
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
  const rel =
    ctx.persona && ctx.settings.userRelationshipsEnabled && character.trackRelationship
      ? getRelationship(character.id, ctx.persona.id)
      : null;
  const others = ctx.characters.filter((c) => c.id !== character.id);
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
  let nextSceneInfo = "";
  if (ctx.story && ctx.stage.sceneId) {
    const idx = ctx.story.sceneIds.indexOf(ctx.stage.sceneId);
    if (idx !== -1 && idx < ctx.story.sceneIds.length - 1) {
      const next = getScene(ctx.story.sceneIds[idx + 1]);
      if (next) nextSceneInfo = ctx.sub(`NEXT SCENE (if the story should advance): ${next.name} — ${next.setup}`);
    }
  }

  const system = [
    `You are the NARRATOR of an ongoing roleplay. You describe scenery, atmosphere, events and transitions; you move the plot forward. You never speak or decide for the characters or the user.`,
    `CHARACTERS: ${ctx.characters.map((c) => `${c.name} — ${ctx.sub(c.description, c.name).slice(0, 200)}`).join("; ")}`,
    worldBlock(ctx),
    personaBlock(ctx),
    nextSceneInfo,
    ctx.summaryText ? `SUMMARY OF EARLIER CONVERSATION:\n${ctx.summaryText}` : "",
    lore.length ? `WORLD KNOWLEDGE (relevant lore):\n${lore.map((l) => `- ${l}`).join("\n")}` : "",
    `RULES:\n${formatRules(ctx, null)}\n` +
      `Write a short narration (2-5 sentences) that helps the plot proceed. Narration is all description — asterisks are optional for you.\n` +
      (nextSceneInfo
        ? `If the current scene has clearly run its course and the story should move to the next scene, write the transition and append the tag <next-scene/> on its own line right after the narration.\n`
        : "") +
      `Then ALWAYS end with 2-4 suggested actions the user could take next, formatted exactly as:\n` +
      `<options><o>first suggestion</o><o>second suggestion</o></options>\n` +
      `Each suggestion is written as the user's own message (matching the point-of-view rules above), ready to send as-is.`,
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
  const candidates = ctx.characters.map((c) => `"${c.id}" = ${c.name}`);
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
  const candidates = ctx.characters.map((c) => `"${c.id}" = ${c.name}`).join("\n");
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
