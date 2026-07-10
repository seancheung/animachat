import { callLlm, estimateTokens, extractJson, resolveModel } from "./client";
import { activeContent, buildContext, speakerName, verbatimWindow, type ChatContext } from "./prompts";
import {
  addFact,
  getRelationship,
  putRelationship,
  putSummary,
} from "@/lib/store";
import type { Message } from "@/lib/types";

const inFlight = new Set<string>();

interface MemoryOutput {
  summary?: string;
  facts?: { character?: string; fact?: string }[];
  relationships?: { character?: string; affinityDelta?: number; note?: string }[];
}

function chunkTranscript(ctx: ChatContext, chunk: Message[]): string {
  return chunk
    .map((m) => {
      const content = activeContent(m);
      return content ? `${speakerName(ctx, m)}: ${content}` : null;
    })
    .filter(Boolean)
    .join("\n");
}

/** Messages that have scrolled out of the verbatim window and aren't summarized yet. */
function pendingChunk(ctx: ChatContext, windowStart: number): Message[] {
  return ctx.messages.filter(
    (m) => m.position > ctx.summaryCovered && m.position < windowStart && m.role !== "marker"
  );
}

export function pendingMemoryTokens(chatId: string): number {
  const ctx = buildContext(chatId);
  let model;
  try {
    model = resolveModel("memory", ctx.chat);
  } catch {
    return 0;
  }
  const window = verbatimWindow(ctx, model);
  const windowStart = window[0]?.position ?? Number.MAX_SAFE_INTEGER;
  return pendingChunk(ctx, windowStart).reduce((n, m) => n + estimateTokens(activeContent(m)), 0);
}

/**
 * Rolling summarization + fact extraction + affinity update.
 * Triggered in the background after responses; `force` is the synchronous safety valve.
 */
export async function runMemoryPass(chatId: string, force = false): Promise<void> {
  if (inFlight.has(chatId)) return;
  inFlight.add(chatId);
  try {
    const ctx = buildContext(chatId);
    const modelRef = resolveModel("memory", ctx.chat);
    const window = verbatimWindow(ctx, modelRef);
    const windowStart = window[0]?.position ?? Number.MAX_SAFE_INTEGER;
    const chunk = pendingChunk(ctx, windowStart);
    if (!chunk.length) return;
    const chunkTokens = chunk.reduce((n, m) => n + estimateTokens(activeContent(m)), 0);
    if (!force && chunkTokens < ctx.chunkThreshold) return;

    const characters = ctx.characters.map((c) => c.name).join(", ");
    const system =
      `You maintain the long-term memory of a roleplay chat. You will receive the existing rolling summary ` +
      `plus a chunk of messages that just left the recent-context window. Respond with ONLY a JSON object:\n` +
      `{"summary": "updated rolling summary, chronological, <= 400 words, keep every plot-critical fact",\n` +
      ` "facts": [{"character": "name", "fact": "a durable fact this character learned/experienced, worth remembering across sessions"}],\n` +
      ` "relationships": [{"character": "name", "affinityDelta": -10..10, "note": "one-line current state of the character's relationship with ${
        ctx.persona?.name ?? "the user"
      }"}]}\n` +
      `Characters: ${characters}. Extract at most 5 facts; only genuinely durable ones. Write the summary in ${ctx.language}.`;
    const user =
      `EXISTING SUMMARY:\n${ctx.summaryText || "(none yet)"}\n\nNEW MESSAGES TO FOLD IN:\n` +
      chunkTranscript(ctx, chunk);

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

    putSummary(chatId, out.summary, chunk[chunk.length - 1].position);

    const byName = new Map(ctx.characters.map((c) => [c.name.toLowerCase(), c]));
    for (const f of out.facts ?? []) {
      const c = f.character && byName.get(f.character.toLowerCase());
      if (c && f.fact) addFact(c.id, chatId, f.fact);
    }
    if (ctx.persona) {
      for (const r of out.relationships ?? []) {
        const c = r.character && byName.get(r.character.toLowerCase());
        if (!c || !c.trackRelationship) continue;
        const cur = getRelationship(c.id, ctx.persona.id);
        const affinity = (cur?.affinity ?? 0) + (Number(r.affinityDelta) || 0);
        putRelationship(c.id, ctx.persona.id, affinity, r.note ?? cur?.notes ?? "");
      }
    }
  } finally {
    inFlight.delete(chatId);
  }
}

/** Safety valve: catch up synchronously when un-summarized history has piled up too far. */
export async function ensureMemoryCaughtUp(chatId: string, chunkThreshold: number): Promise<void> {
  if (pendingMemoryTokens(chatId) > chunkThreshold * 3) {
    await runMemoryPass(chatId, true).catch(() => {});
  }
}
