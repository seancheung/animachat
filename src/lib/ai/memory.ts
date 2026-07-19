import { callLlm, estimateTokens, extractJson, resolveModel, type ResolvedModel } from "./client";
import {
  activeContent,
  buildContext,
  messageCost,
  speakerName,
  verbatimBudget,
  verbatimWindow,
  type ChatContext,
} from "./prompts";
import {
  addFact,
  getCharacter,
  getCharRelationship,
  getMindState,
  getRelationship,
  getStoryBonds,
  listFacts,
  putCharRelationship,
  putMindState,
  putRelationship,
  putStoryBonds,
  putSummary,
} from "@/lib/store";
import { alivenessOf, type Message, type StoryBond } from "@/lib/types";

const inFlight = new Map<string, Promise<void>>();

/** The window boundary must match what chat prompts actually send, so it is
 *  computed with the CHAT task's model — windowing with the memory model would
 *  open a gap (or overlap) whenever the two models' budgets differ. */
async function windowModel(ctx: ChatContext, memoryModel: ResolvedModel): Promise<ResolvedModel> {
  try {
    return await resolveModel("chat", ctx.chat);
  } catch {
    return memoryModel;
  }
}

interface MemoryOutput {
  summary?: string;
  facts?: { character?: string; fact?: string }[];
  relationships?: { character?: string; towards?: string; affinityDelta?: number; note?: string }[];
  mindStates?: { character?: string; state?: string }[];
  bonds?: { character?: string; towards?: string; stance?: string; note?: string }[];
}

async function chunkTranscript(ctx: ChatContext, chunk: Message[]): Promise<string> {
  const lines: string[] = [];
  for (const m of chunk) {
    const content = activeContent(m);
    if (content) lines.push(`${await speakerName(ctx, m)}: ${content}`);
  }
  return lines.join("\n");
}

/** Messages that have scrolled out of the verbatim window and aren't summarized yet. */
function pendingChunk(ctx: ChatContext, windowStart: number): Message[] {
  return ctx.messages.filter(
    (m) => m.position > ctx.summaryCovered && m.position < windowStart && m.role !== "marker"
  );
}

/** The two-stage march toward the next memory pass, for the drawer's Memory tab:
 *  how full the verbatim window is (stage one — nothing summarizes while all
 *  history still fits), then how far the scrolled-out chunk has crept toward the
 *  threshold (stage two — the trigger's own measurement, so the bar can't drift
 *  from what actually fires the pass). Null when no memory model resolves: no
 *  pass will ever run. */
export async function memoryProgress(chatId: string): Promise<{
  window: { tokens: number; budget: number };
  pending: { tokens: number; threshold: number };
} | null> {
  const ctx = await buildContext(chatId);
  let model;
  try {
    model = await resolveModel("memory", ctx.chat);
  } catch {
    return null;
  }
  const wModel = await windowModel(ctx, model);
  const window = verbatimWindow(ctx, wModel, { includeUnsummarized: false });
  const windowStart = window[0]?.position ?? Number.MAX_SAFE_INTEGER;
  const tokens = pendingChunk(ctx, windowStart).reduce((n, m) => n + estimateTokens(activeContent(m)), 0);
  return {
    window: {
      tokens: window.reduce((n, m) => n + messageCost(m), 0),
      budget: verbatimBudget(ctx, wModel),
    },
    pending: { tokens, threshold: ctx.chunkThreshold },
  };
}

export async function pendingMemoryTokens(chatId: string): Promise<number> {
  return (await memoryProgress(chatId))?.pending.tokens ?? 0;
}

/**
 * Rolling summarization + fact extraction + affinity update.
 * Triggered in the background after responses; `force` is the synchronous safety valve.
 */
export function runMemoryPass(chatId: string, force = false): Promise<void> {
  // one pass per chat at a time; a forced caller (the safety valve) joins the
  // running pass instead of silently no-opping against the stale summary
  const running = inFlight.get(chatId);
  if (running) return force ? running : Promise.resolve();
  const pass = doMemoryPass(chatId, force).finally(() => inFlight.delete(chatId));
  inFlight.set(chatId, pass);
  return pass;
}

async function doMemoryPass(chatId: string, force: boolean): Promise<void> {
  const ctx = await buildContext(chatId);
  const modelRef = await resolveModel("memory", ctx.chat);
  const window = verbatimWindow(ctx, await windowModel(ctx, modelRef), { includeUnsummarized: false });
  const windowStart = window[0]?.position ?? Number.MAX_SAFE_INTEGER;
  const chunk = pendingChunk(ctx, windowStart);
  if (!chunk.length) return;
  const chunkTokens = chunk.reduce((n, m) => n + estimateTokens(activeContent(m)), 0);
  if (!force && chunkTokens < ctx.chunkThreshold) return;

  const characters = ctx.characters.map((c) => c.name).join(", ");
  // playing as narrator there is no user character — relationship targets are
  // characters only (persona-relationship writes are guarded off by ctx.persona below)
  const userName = ctx.persona?.name ?? (ctx.chat.playAsNarrator ? "the narrator" : "the user");
  // state of mind: casual/immersive only (playthroughs pace themselves), per character opt-in
  const mindChars = ctx.snapshot ? [] : ctx.characters.filter((c) => alivenessOf(c).mindState);
  // story-local bonds: playthroughs only — embedded cast never touch the library's
  // relationship tables (a replay starts fresh), but within one run the cast's
  // stances toward the player and each other evolve. Gated by the same global
  // relationship switches (per direction, at write time) and per-character tracking.
  const bondChars =
    ctx.snapshot && (ctx.settings.userRelationshipsEnabled || ctx.settings.charRelationshipsEnabled)
      ? ctx.characters.filter((c) => c.trackRelationship)
      : [];
  // in story mode ctx.persona is the played cast member's sheet (or a persona); null = spectating
  const playerName = ctx.persona?.name ?? null;
  const system =
    `You maintain the long-term memory of ${ctx.chat.mode === "casual" ? "an ongoing text conversation" : "a roleplay chat"}. You will receive the existing rolling summary ` +
    `plus a chunk of messages that just left the recent-context window. Respond with ONLY a JSON object:\n` +
    `{"summary": "updated rolling summary, chronological, <= 400 words, keep every plot-critical fact",\n` +
    ` "facts": [{"character": "name", "fact": "a durable fact this character learned/experienced, worth remembering across sessions"}],\n` +
    ` "relationships": [{"character": "name", "towards": "who the feeling is about — '${userName}' or another character's name", "affinityDelta": -10..10, "note": "current state of that relationship in 1-3 short lines: standing, any unresolved tension, what recently shifted"}]` +
    (mindChars.length
      ? `,\n "mindStates": [{"character": "name", "state": "1-3 short present-tense lines: current mood, what they want right now, threads left unresolved on their mind"}]`
      : "") +
    (bondChars.length
      ? `,\n "bonds": [{"character": "name", "towards": "${playerName ? `'${playerName}' or another cast member's name` : "another cast member's name"}", "stance": "one or two words, e.g. guarded / warming / wary / loyal", "note": "one short line: what the stance rests on, what recently shifted"}]`
      : "") +
    `}\n` +
    `Characters: ${characters}. The user is ${userName}. Report a relationships entry only when it meaningfully shifted. ` +
    (mindChars.length
      ? `Report a mindStates entry for each of: ${mindChars.map((c) => c.name).join(", ")} — it REPLACES their previous state, so carry forward whatever still weighs on them. `
      : "") +
    (bondChars.length
      ? `Bonds are this story's evolving relationship states (descriptive, not numeric). Report a character's bonds only when something meaningfully shifted — but a reported set REPLACES that character's previous bonds, so re-list the ones that still stand. `
      : "") +
    `Extract at most 5 facts; only genuinely durable ones, never one already recorded. Write the summary in ${ctx.language}.`;
  // show already-recorded facts so the model doesn't re-extract them — duplicates
  // crowd genuinely distinct older facts out of the character prompts
  const knownFactLines: string[] = [];
  for (const c of ctx.characters) {
    const known = (await listFacts(c.id, 20)).map((f) => f.content);
    if (known.length) knownFactLines.push(`${c.name}: ${known.join(" | ")}`);
  }
  const knownFacts = knownFactLines.join("\n");
  const currentMindLines: string[] = [];
  for (const c of mindChars) {
    const m = await getMindState(c.id, chatId);
    if (m?.content) currentMindLines.push(`${c.name}: ${m.content}`);
  }
  const currentMinds = currentMindLines.join("\n");
  const currentBondLines: string[] = [];
  for (const c of bondChars) {
    const rec = await getStoryBonds(chatId, c.id);
    if (rec?.bonds.length)
      currentBondLines.push(
        `${c.name}: ${rec.bonds.map((b) => `toward ${b.towards} — ${b.stance}${b.note ? ` (${b.note})` : ""}`).join("; ")}`
      );
  }
  const currentBonds = currentBondLines.join("\n");
  const user =
    `EXISTING SUMMARY:\n${ctx.summaryText || "(none yet)"}\n\n` +
    (knownFacts ? `FACTS ALREADY RECORDED (never repeat these):\n${knownFacts}\n\n` : "") +
    (currentMinds ? `CURRENT STATES OF MIND (update these):\n${currentMinds}\n\n` : "") +
    (currentBonds ? `CURRENT BONDS (a reported set replaces that character's list):\n${currentBonds}\n\n` : "") +
    `NEW MESSAGES TO FOLD IN:\n` +
    (await chunkTranscript(ctx, chunk));

  const raw = await callLlm({
    modelRef,
    system,
    messages: [{ role: "user", content: user }],
    maxTokens: 1500,
    feature: "memory",
    chatId,
  });
  const out = extractJson<MemoryOutput>(raw);
  if (!out?.summary) return;

  await putSummary(chatId, out.summary, chunk[chunk.length - 1].position);

  // facts & relationships live in the library (across chats) — playthrough snapshot
  // characters that were since deleted from the library are skipped fail-soft
  const inLibrary = async (id: string) => !!(await getCharacter(id));
  const byName = new Map(ctx.characters.map((c) => [c.name.toLowerCase(), c]));
  if (ctx.playedCharacter) byName.set(ctx.playedCharacter.name.toLowerCase(), ctx.playedCharacter);
  for (const f of out.facts ?? []) {
    const c = f.character && byName.get(f.character.toLowerCase());
    if (c && f.fact && (await inLibrary(c.id))) await addFact(c.id, chatId, f.fact);
  }
  // states of mind are chat-scoped; only characters that opted in are written
  for (const s of out.mindStates ?? []) {
    const c = s.character && byName.get(s.character.toLowerCase());
    if (c && s.state && mindChars.some((mc) => mc.id === c.id) && (await inLibrary(c.id)))
      await putMindState(c.id, chatId, s.state);
  }
  // story-local bonds: chat-scoped, keyed by the snapshot cast id — deliberately no
  // library guard (embedded cast are exactly whom this table exists for). A character's
  // reported set replaces their stored one; unreported characters keep theirs.
  if (bondChars.length) {
    const wanted = new Map<string, StoryBond[]>();
    for (const b of out.bonds ?? []) {
      const c = b.character && byName.get(b.character.toLowerCase());
      if (!c || !b.stance || !bondChars.some((bc) => bc.id === c.id)) continue;
      const towards = (b.towards ?? "").trim();
      if (!towards || towards.toLowerCase() === c.name.toLowerCase()) continue;
      const isPlayer =
        (!!playerName && towards.toLowerCase() === playerName.toLowerCase()) || towards.toLowerCase() === "user";
      if (isPlayer && !playerName) continue; // spectator run — nobody to bond toward
      const target = isPlayer ? null : byName.get(towards.toLowerCase());
      if (!isPlayer && !target) continue; // a name the cast doesn't contain — dropped fail-soft
      // the global relationship switches gate per direction, same meaning as in the library
      if (isPlayer ? !ctx.settings.userRelationshipsEnabled : !ctx.settings.charRelationshipsEnabled) continue;
      const list = wanted.get(c.id) ?? [];
      list.push({
        towards: isPlayer ? playerName! : target!.name,
        stance: String(b.stance).slice(0, 60),
        note: String(b.note ?? "").slice(0, 300),
      });
      wanted.set(c.id, list);
    }
    for (const [cid, bonds] of wanted) await putStoryBonds(chatId, cid, bonds.slice(0, 6));
  }
  for (const r of out.relationships ?? []) {
    const c = r.character && byName.get(r.character.toLowerCase());
    if (!c || !c.trackRelationship || !(await inLibrary(c.id))) continue;
    const towards = (r.towards ?? "").trim().toLowerCase();
    const target = towards ? byName.get(towards) : undefined;
    const playedTarget = target && target.id === ctx.playedCharacter?.id;
    if (target && !playedTarget) {
      // character → character (global switch + both sides' tracking must be on)
      if (!ctx.settings.charRelationshipsEnabled) continue;
      if (target.id === c.id || !target.trackRelationship || !(await inLibrary(target.id))) continue;
      const cur = await getCharRelationship(c.id, target.id);
      const affinity = (cur?.affinity ?? 0) + (Number(r.affinityDelta) || 0);
      await putCharRelationship(c.id, target.id, affinity, r.note ?? cur?.notes ?? "");
    } else if (
      ctx.persona &&
      ctx.settings.userRelationshipsEnabled &&
      (playedTarget || !towards || towards === "user" || towards === ctx.persona.name.toLowerCase())
    ) {
      if (ctx.playedCharacter) {
        // playing a cast member: the "user relationship" is character↔character
        if (!(await inLibrary(ctx.playedCharacter.id))) continue;
        const cur = await getCharRelationship(c.id, ctx.playedCharacter.id);
        const affinity = (cur?.affinity ?? 0) + (Number(r.affinityDelta) || 0);
        await putCharRelationship(c.id, ctx.playedCharacter.id, affinity, r.note ?? cur?.notes ?? "");
      } else {
        const cur = await getRelationship(c.id, ctx.persona.id);
        const affinity = (cur?.affinity ?? 0) + (Number(r.affinityDelta) || 0);
        await putRelationship(c.id, ctx.persona.id, affinity, r.note ?? cur?.notes ?? "");
      }
    }
  }
}

/** Safety valve: catch up synchronously when un-summarized history exceeds what the
 *  verbatim window's overflow allowance can carry (one chunk threshold — see
 *  verbatimWindow). Joining a pass that was already running may have been a no-op,
 *  so re-check once and force our own. */
export async function ensureMemoryCaughtUp(chatId: string, chunkThreshold: number): Promise<void> {
  if ((await pendingMemoryTokens(chatId)) <= chunkThreshold) return;
  await runMemoryPass(chatId, true).catch(() => {});
  if ((await pendingMemoryTokens(chatId)) > chunkThreshold) {
    await runMemoryPass(chatId, true).catch(() => {});
  }
}
