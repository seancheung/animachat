import { callLlm, extractJson, resolveModel } from "./client";
import { humanDuration, resumeGapMs, returnEligibility } from "./aliveness";
import { activeContent, buildContext, speakerName, type ChatContext } from "./prompts";
import { getMindState, getOffscreenNote, listFacts, putOffscreenNote } from "@/lib/store";

/** What a return to a chat triggered — the client fires the texts-first turn. */
export interface ReturnResult {
  /** character ids whose off-screen note was (re)generated */
  generated: string[];
  /** character to fire a texts-first turn for, or null */
  texter: string | null;
}

const NONE: ReturnResult = { generated: [], texter: null };

// one return pass per chat at a time — a second tab opening the same chat joins
// the running pass instead of generating (and texting) twice
const inFlight = new Map<string, Promise<ReturnResult>>();

export function runReturnPass(chatId: string): Promise<ReturnResult> {
  const running = inFlight.get(chatId);
  if (running) return running;
  const pass = doReturnPass(chatId).finally(() => inFlight.delete(chatId));
  inFlight.set(chatId, pass);
  return pass;
}

/**
 * The user came back to a casual chat after a real-time gap: generate (in one
 * batched call) what each opted-in character has been up to meanwhile, store the
 * notes, and name the character who should text first (if any opted into that).
 * The server is the authority — the client's gap check is only a saved request.
 */
async function doReturnPass(chatId: string): Promise<ReturnResult> {
  const ctx = await buildContext(chatId);
  // returnEligibility's note lookup stays sync (aliveness.ts is pure) — prefetch the notes
  const noteCreatedAt = new Map<string, number | null>();
  for (const c of ctx.characters) {
    noteCreatedAt.set(c.id, (await getOffscreenNote(c.id, chatId))?.createdAt ?? null);
  }
  const { generateFor, texter } = returnEligibility(
    ctx.chat,
    ctx.characters,
    ctx.messages,
    (cid) => noteCreatedAt.get(cid) ?? null,
    Date.now()
  );
  if (!generateFor.length) return NONE;

  const gap = humanDuration(resumeGapMs(ctx.messages, Date.now()));
  const sheetParts: string[] = [];
  for (const c of generateFor) {
    const mind = (await getMindState(c.id, chatId))?.content;
    const facts = (await listFacts(c.id, 5))
      .map((f) => f.content)
      .join(" | ");
    sheetParts.push(
      `${c.name}:\n${ctx.sub(c.description, c.name).slice(0, 600)}` +
        (mind ? `\nOn their mind lately: ${mind}` : "") +
        (facts ? `\nThey remember: ${facts}` : "")
    );
  }
  const sheets = sheetParts.join("\n\n");
  const tailLines: string[] = [];
  for (const m of ctx.messages.slice(-6)) {
    const content = activeContent(m);
    if (content) tailLines.push(`${await speakerName(ctx, m)}: ${content.slice(0, 300)}`);
  }
  const tail = tailLines.join("\n");

  const system =
    `You imagine the off-screen life of roleplay characters between conversations with ${ctx.persona?.name ?? "the user"}. ` +
    `About ${gap} of real time has passed since the conversation below left off. For EACH character listed, write 1-3 sentences ` +
    `of what they have plausibly been doing meanwhile — concrete, everyday texture consistent with who they are, their mood, and where the ` +
    `conversation stood. Present-perfect voice ("has been…"). Never decide anything for ${ctx.persona?.name ?? "the user"}, ` +
    `introduce world-changing events, or write dialogue. Respond with ONLY a JSON object:\n` +
    `{"notes": [{"character": "name", "note": "…"}]}\n` +
    `Write the notes in ${ctx.language}.`;
  const user = `CHARACTERS:\n${sheets}\n\nHOW THE CONVERSATION LEFT OFF:\n${tail || "(no recent messages)"}`;

  const modelRef = await resolveModel("offscreen", ctx.chat);
  const raw = await callLlm({
    modelRef,
    system,
    messages: [{ role: "user", content: user }],
    maxTokens: 200 * generateFor.length + 100,
    feature: "offscreen",
    chatId,
  });
  const out = extractJson<{ notes?: { character?: string; note?: string }[] }>(raw);
  const byName = new Map(generateFor.map((c) => [c.name.toLowerCase(), c]));
  const generated: string[] = [];
  for (const n of out?.notes ?? []) {
    const c = n.character && byName.get(n.character.toLowerCase());
    if (c && n.note && !generated.includes(c.id)) {
      await putOffscreenNote(c.id, chatId, n.note);
      generated.push(c.id);
    }
  }
  // the texter only texts off a stored note — if the model skipped theirs, stay silent
  return { generated, texter: texter && generated.includes(texter.id) ? texter.id : null };
}

/** Server-side guard for a texts-first turn: the tail may have moved (another tab
 *  already fired it) between the return pass and the generate request. */
export function returnTurnEligible(ctx: ChatContext, characterId: string | undefined): boolean {
  if (!characterId) return false;
  const { texter } = returnEligibility(
    ctx.chat,
    ctx.characters,
    ctx.messages,
    // for the RE-check the note is expected to be fresh (the return pass just wrote
    // it) — what matters is that no message landed after it was written
    () => null,
    Date.now()
  );
  return texter?.id === characterId;
}
