import { bad, handler, type IdParams } from "@/lib/api";
import {
  AiConfigError,
  callLlm,
  extractJson,
  resolveModel,
  streamLlm,
  type ResolvedModel,
} from "@/lib/ai/client";
import { ensureMemoryCaughtUp, runMemoryPass } from "@/lib/ai/memory";
import {
  buildCharacterRequest,
  buildContext,
  buildDirectorRequest,
  buildNarratorRequest,
  buildOrchestratorRequest,
  buildTitleRequest,
  cleanTitle,
  computeStage,
  resolveStageAssets,
  type ChatContext,
} from "@/lib/ai/prompts";
import { returnTurnEligible } from "@/lib/ai/offscreen";
import { PureChatStreamFilter, toPureChat } from "@/lib/ai/pureChat";
import { TagStreamParser, type TagEvent } from "@/lib/ai/tags";
import { allowedNextScenes } from "@/lib/stage";
import { parseMentions, tagMentions } from "@/lib/mentions";
import { addVariant, appendMessage, getChat, getMessage, saveChat, setRawOutput } from "@/lib/store";
import { taskMaxTokens, type Character, type Message, type SceneEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

interface GenerateBody {
  /** auto = orchestrator decides; character/narrator force a speaker;
   *  return = a texts-first turn after the user came back (characterId required) */
  mode?: "auto" | "character" | "narrator" | "return";
  characterId?: string;
  /** append this user message before generating (omit to just continue) */
  userText?: string;
  /** regenerate: add a new swipe variant to this existing message */
  regenerateMessageId?: string;
}

interface Speaker {
  role: "character" | "narrator";
  character: Character | null;
  /** texts-first turn: the character re-opens the conversation after the user's absence */
  returning?: boolean;
}

/** Hard cap on AI turns per request — characters chaining mentions can't loop forever
 *  (lifted while the chat's infinite-mentions override is on). */
const MAX_TURNS = 8;

/** Present characters a text's <mention> tags address — exact name match, in order,
 *  deduped, optionally excluding the author (self-mentions never pass the turn). */
function mentionedPresent(ctx: ChatContext, text: string, exceptId?: string): Character[] {
  const mentions = parseMentions(text);
  if (mentions.all) return ctx.present.filter((c) => c.id !== exceptId);
  const out: Character[] = [];
  for (const n of mentions.names) {
    const c = ctx.present.find((x) => x.name.toLowerCase() === n.toLowerCase());
    if (c && c.id !== exceptId && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Loose name match for narrator <enter>/<leave> payloads — fail-soft (null on no match). */
function matchCharacter(ctx: ChatContext, name: string): Character | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  return (
    ctx.characters.find((c) => c.name.toLowerCase() === n) ??
    ctx.characters.find((c) => c.name.toLowerCase().startsWith(n)) ??
    null
  );
}

/** Loose title match for narrator <reveal> payloads — fail-soft (null on no match). */
function matchSecret(ctx: ChatContext, title: string) {
  const t = title.trim().toLowerCase();
  if (!t) return null;
  const secrets = ctx.snapshot?.secrets ?? [];
  return (
    secrets.find((s) => s.title.toLowerCase() === t) ??
    secrets.find((s) => s.title.toLowerCase().startsWith(t)) ??
    null
  );
}

async function pickDefaultSpeakers(ctx: ChatContext): Promise<Speaker[]> {
  if (ctx.present.length === 1 && !ctx.chat.narratorEnabled) {
    return [{ role: "character", character: ctx.present[0] }];
  }
  if (ctx.present.length === 0) {
    if (ctx.chat.narratorEnabled) return [{ role: "narrator", character: null }];
    throw new Error("Nobody is on stage to reply");
  }

  // story mode: the DIRECTOR routes — contract-aware, may schedule narrator + reactor
  if (ctx.chat.mode === "story" && ctx.snapshot) {
    const modelRef = await resolveModel("director", ctx.chat);
    const req = await buildDirectorRequest(ctx, modelRef);
    const raw = await callLlm({
      modelRef,
      system: req.system,
      messages: req.messages,
      maxTokens: 120,
      feature: "director",
      chatId: ctx.chat.id,
    });
    const parsed = extractJson<{ next?: string | string[] }>(raw);
    const names = Array.isArray(parsed?.next) ? parsed.next : parsed?.next ? [parsed.next] : [];
    const out: Speaker[] = [];
    for (const n of names.slice(0, 2)) {
      if (n === "narrator") out.push({ role: "narrator", character: null });
      else {
        const c = ctx.present.find((x) => x.id === n);
        if (c) out.push({ role: "character", character: c });
      }
    }
    // a doubled speaker adds nothing — keep the first occurrence only
    if (out.length === 2 && out[0].role === out[1].role && out[0].character?.id === out[1].character?.id)
      out.pop();
    if (out.length) return out;
    // malformed decision: the narrator can always carry a story turn
    return [{ role: "narrator", character: null }];
  }

  // casual/immersive group chat and/or narrator: ask the orchestrator
  const modelRef = await resolveModel("orchestrator", ctx.chat);
  const req = await buildOrchestratorRequest(ctx, modelRef);
  const raw = await callLlm({
    modelRef,
    system: req.system,
    messages: req.messages,
    maxTokens: 100,
    feature: "orchestrator",
    chatId: ctx.chat.id,
  });
  const parsed = extractJson<{ next?: string }>(raw);
  const next = parsed?.next;
  if (next === "narrator" && ctx.chat.narratorEnabled) return [{ role: "narrator", character: null }];
  const c = ctx.present.find((x) => x.id === next);
  return [{ role: "character", character: c ?? ctx.present[0] }];
}

/**
 * Who replies to this turn — possibly several speakers:
 * "@all" → every character in chat order; "@name" mentions (partial names,
 * nicknames) → the orchestrator resolves them, each replying in turn.
 */
async function pickSpeakers(ctx: ChatContext, body: GenerateBody): Promise<Speaker[]> {
  if (body.mode === "narrator") {
    if (ctx.chat.playAsNarrator) throw new Error("You are the narrator in this chat");
    return [{ role: "narrator", character: null }];
  }
  if ((body.mode === "character" || body.mode === "return") && body.characterId) {
    const c = ctx.present.find((x) => x.id === body.characterId);
    if (!c) throw new Error("Character not on stage in this chat");
    return [{ role: "character", character: c, returning: body.mode === "return" }];
  }
  const text = body.userText?.trim() ?? "";
  if (text && ctx.present.length > 0) {
    // the user's mentions arrive as <mention> tags (written by tagMentions on append) —
    // resolved deterministically by exact name; anything unresolved falls through
    const addressed = mentionedPresent(ctx, text);
    if (addressed.length)
      return addressed.map((c) => ({ role: "character" as const, character: c }));
  }
  return pickDefaultSpeakers(ctx);
}

/** Where <next-scene/> lands: the targeted form's payload is matched fail-soft against
 *  the roads open from the current scene (declared successors, or the next in order —
 *  a played cast member's story advances only through THEIR scenes); the bare tag or an
 *  unresolved payload takes the first open road. Null = final scene, nothing ahead. */
function resolveNextScene(ctx: ChatContext, target: string | null): string | null {
  const snap = ctx.snapshot;
  if (!snap || !ctx.stage.sceneId) return null;
  const allowed = allowedNextScenes(
    snap.scenes.map(({ id, cast, successors }) => ({ id, cast, successors })),
    ctx.stage.sceneId,
    ctx.chat.personaCharacterId
  );
  if (!allowed.length) return null;
  const t = target?.trim().toLowerCase();
  if (t) {
    const nameOf = (id: string) =>
      snap.scenes.find((s) => s.id === id)?.name.trim().toLowerCase() ?? "";
    const hit = allowed.find((id) => nameOf(id) === t) ?? allowed.find((id) => nameOf(id).startsWith(t));
    if (hit) return hit;
  }
  return allowed[0];
}

async function maybeGenerateTitle(chatId: string) {
  try {
    const ctx = await buildContext(chatId);
    // playthroughs are titled at creation ("Playthrough — <played name>") — never by AI
    if (ctx.chat.mode === "story") return;
    if (ctx.chat.title !== "New chat" || ctx.messages.length < 2) return;
    const modelRef = await resolveModel("title", ctx.chat);
    const req = await buildTitleRequest(ctx);
    void callLlm({
      modelRef,
      system: req.system,
      messages: req.messages,
      maxTokens: 40,
      feature: "title",
      chatId,
    })
      .then(async (t) => {
        const title = cleanTitle(t);
        // re-check right before saving: the model call takes seconds, and a user
        // rename in that window (likely — the chat is new) must not be overwritten
        if (title && (await getChat(chatId))?.title === "New chat")
          await saveChat({ id: chatId, title });
      })
      .catch(() => {});
  } catch {
    /* no model configured yet — skip */
  }
}

export const POST = handler(async (req: Request, { params }: IdParams) => {
  const { id: chatId } = await params;
  if (!(await getChat(chatId))) return bad("Chat not found", 404);
  const body = (await req.json()) as GenerateBody;

  // append the user's message first so it's part of the context — converting exact
  // @Name/@all into <mention> tags against the on-stage cast (presence can't change
  // from a user message, so resolving names pre-append is safe)
  if (body.userText?.trim()) {
    const pre = await buildContext(chatId);
    body.userText = tagMentions(body.userText.trim(), pre.present.map((c) => c.name));
    // playing as narrator: the user's messages ARE narrator messages — narration, not
    // a persona's dialogue (casual/immersive only, so no staging tags to parse)
    await appendMessage({ chatId, role: pre.chat.playAsNarrator ? "narrator" : "user", content: body.userText });
  }

  let ctx = await buildContext(chatId);

  // texts-first re-guard: between the return pass and this request the tail may
  // have moved (another tab's turn landed) — then the return is already spoken
  // for, and the right response is silence, not an error banner
  if (body.mode === "return" && !returnTurnEligible(ctx, body.characterId)) {
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" } }
    );
  }

  // regeneration targets an existing message; context stops before it
  let regenTarget: Message | null = null;
  if (body.regenerateMessageId) {
    regenTarget = await getMessage(body.regenerateMessageId);
    if (!regenTarget || regenTarget.chatId !== chatId) return bad("Message to regenerate not found");
    if (regenTarget.role !== "character" && regenTarget.role !== "narrator")
      return bad("Only AI messages can be regenerated");
    // when the user plays the narrator, narrator messages are human-written — edit, don't regenerate
    if (regenTarget.role === "narrator" && ctx.chat.playAsNarrator)
      return bad("You are the narrator in this chat — narrator messages are yours to edit, not regenerate");
    // alternatives live on the tail only — appendMessage freezes a message the moment a
    // follow-up lands, so regenerating anything older would fight the freeze
    const lastLive = [...ctx.messages].reverse().find((m) => m.role !== "marker");
    if (lastLive?.id !== regenTarget.id)
      return bad("Only the latest message can be regenerated — fork the chat to branch from an earlier point");
    ctx = { ...ctx, messages: ctx.messages.filter((m) => m.position < regenTarget!.position) };
  }

  let speakers: Speaker[];
  try {
    if (regenTarget) {
      const speaker: Speaker =
        regenTarget.role === "narrator"
          ? { role: "narrator", character: null }
          : {
              role: "character",
              character: ctx.characters.find((c) => c.id === regenTarget!.characterId) ?? null,
            };
      if (speaker.role === "character" && !speaker.character) return bad("Character no longer in chat");
      speakers = [speaker];
    } else {
      speakers = await pickSpeakers(ctx, body);
    }
    // resolve the first speaker's model up front so config problems fail the request
    await resolveModel(
      speakers[0].role === "narrator" ? "narrator" : "chat",
      ctx.chat,
      speakers[0].character?.id
    );
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), e instanceof AiConfigError ? 409 : 400);
  }

  // safety valve: catch up summarization before assembling a prompt that won't fit
  await ensureMemoryCaughtUp(chatId, ctx.chunkThreshold);

  const regenMessages = ctx.messages;
  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  // a listener attached after the signal already fired never runs — without this a
  // client gone before the stream starts would still generate the whole turn chain
  if (req.signal.aborted) abort.abort();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* client disconnected — don't crash the stream task; the abort signal ends the loop */
        }
      };

      let savedAny = false;
      const queue: Speaker[] = [...speakers];
      let turns = 0;
      let wasInfinite = false;
      while (queue.length > 0) {
        if (abort.signal.aborted) break;

        // fresh context per turn so later speakers see earlier replies —
        // and so the infinite-mentions toggle is re-read live from the chat
        let turnCtx: ChatContext;
        try {
          turnCtx = regenTarget ? await buildContext(chatId, regenMessages) : await buildContext(chatId);
        } catch (e) {
          // e.g. the chat was deleted from another tab mid-chain — end the stream
          // with an error event instead of crashing it
          send({ type: "error", message: e instanceof Error ? e.message : String(e) });
          break;
        }

        const infinite = !!turnCtx.chat.overrides.infiniteMentions;
        // kill switch: flipping infinite off mid-chain stops after the reply that just finished
        if (wasInfinite && !infinite) break;
        wasInfinite = infinite;
        if (!infinite && turns >= MAX_TURNS) break;

        const speaker = queue.shift()!;
        turns++;

        let modelRef: ResolvedModel;
        try {
          modelRef = await resolveModel(
            speaker.role === "narrator" ? "narrator" : "chat",
            turnCtx.chat,
            speaker.character?.id
          );
        } catch (e) {
          send({ type: "error", message: e instanceof Error ? e.message : String(e) });
          break;
        }

        const built =
          speaker.role === "narrator"
            ? await buildNarratorRequest(turnCtx, modelRef)
            : await buildCharacterRequest(turnCtx, speaker.character!, modelRef, {
                returning: speaker.returning,
              });

        // pure chat (casual): the convention is enforced mechanically — a streaming
        // filter keeps *action* spans from flashing on screen, and toPureChat on the
        // full text before save stays authoritative (raw keeps the verbatim output)
        const pure = turnCtx.chat.mode === "casual";
        const pureFilter = pure ? new PureChatStreamFilter() : null;

        let content = "";
        let raw = ""; // the model's output verbatim, before tag parsing — kept for debugging
        let emotion: string | null = null;
        let options: string[] | null = null;
        let sawNextScene = false;
        let nextSceneTarget: string | null = null;
        let sawTheEnd = false;
        const enters: string[] = [];
        const leaves: string[] = [];
        const reveals: string[] = [];
        const parser = new TagStreamParser();

        const handleEvents = (events: TagEvent[]) => {
          for (const ev of events) {
            if (ev.type === "text") {
              const text = pureFilter ? pureFilter.feed(ev.text) : ev.text;
              if (!text) continue;
              content += text;
              send({ type: "text", text });
            } else if (ev.type === "emotion") {
              if (pure) continue; // pure chat carries no emotion — a stray tag is dropped whole
              // one emotion per message — the first wins; a stray later tag is
              // stripped from the text and must not flip the live sprite either
              if (!emotion) {
                emotion = ev.name;
                send({ type: "emotion", name: ev.name });
              }
            } else if (ev.type === "options") {
              options = ev.options;
            } else if (ev.type === "nextScene") {
              sawNextScene = true;
              // targeted form at a branch point; resolved at save time (fail-soft)
              nextSceneTarget = nextSceneTarget ?? ev.name ?? null;
            } else if (ev.type === "theEnd") {
              sawTheEnd = true;
            } else if (ev.type === "enter" || ev.type === "leave") {
              // narrator-only staging; resolved to ids at save time (fail-soft)
              (ev.type === "enter" ? enters : leaves).push(ev.name);
            } else if (ev.type === "reveal") {
              // narrator-only; resolved against snapshot secrets at save time (fail-soft)
              reveals.push(ev.name);
            }
          }
        };

        send({
          type: "start",
          speaker: { role: speaker.role, characterId: speaker.character?.id ?? null },
        });

        let failed = false;
        try {
          for await (const ev of streamLlm({
            modelRef,
            system: built.system,
            messages: built.messages,
            maxTokens: taskMaxTokens(turnCtx.settings, speaker.role === "narrator" ? "narrator" : "chat"),
            feature: speaker.role === "narrator" ? "narrator" : "chat",
            chatId,
            signal: abort.signal,
          })) {
            if (ev.type === "text") {
              raw += ev.text;
              handleEvents(parser.feed(ev.text));
            }
          }
          handleEvents(parser.end());
        } catch (e) {
          if (!abort.signal.aborted) {
            handleEvents(parser.end());
            send({ type: "error", message: e instanceof Error ? e.message : String(e) });
          }
          failed = true;
        }
        // an unclosed `*` at stream end was literal — flush what the filter held
        if (pureFilter) {
          const rest = pureFilter.end();
          if (rest) {
            content += rest;
            if (!failed) send({ type: "text", text: rest });
          }
        }

        // the authoritative pure-chat pass (quote unwrapping, whitespace, stray tags) —
        // the stored message is the clean form, so resent history teaches the convention
        if (pure) {
          content = toPureChat(content);
          options = null;
        }
        content = content.trim();
        // an interrupted reply (Stop, closed page, provider error) is incomplete —
        // discard it rather than save a half-written message to the timeline
        if (content && !failed) {
          // stage events come only from the narrator, and never once the story has ended
          let sceneEvent: SceneEvent | null = null;
          if (speaker.role === "narrator" && turnCtx.snapshot && !turnCtx.ended) {
            const ev: SceneEvent = {};
            if (sawNextScene) {
              const next = resolveNextScene(turnCtx, nextSceneTarget);
              if (next) ev.sceneId = next;
            }
            const resolve = (names: string[]) => [
              ...new Set(names.map((n) => matchCharacter(turnCtx, n)?.id).filter((x): x is string => !!x)),
            ];
            const enterIds = resolve(enters);
            const leaveIds = resolve(leaves);
            if (enterIds.length) ev.enter = enterIds;
            if (leaveIds.length) ev.leave = leaveIds;
            const revealIds = [
              ...new Set(reveals.map((t) => matchSecret(turnCtx, t)?.id).filter((x): x is string => !!x)),
            ];
            if (revealIds.length) ev.reveal = revealIds;
            if (sawTheEnd) {
              ev.theEnd = true;
              options = null; // no suggested actions under "The End"
            }
            if (Object.keys(ev).length) sceneEvent = ev;
          }
          let saved: Message | null;
          if (regenTarget) {
            // tail-ness is re-verified inside addVariant — a message frozen while we
            // streamed (follow-up landed, concurrent regen won) returns null and this
            // variant is discarded instead of resurrecting the frozen message's swipes
            saved = await addVariant(regenTarget.id, {
              content,
              emotion,
              options,
              sceneEvent,
              createdAt: Date.now(),
            });
            if (saved) await setRawOutput(saved.id, saved.activeVariant, raw);
          } else {
            saved = await appendMessage({
              chatId,
              role: speaker.role,
              characterId: speaker.character?.id ?? null,
              content,
              emotion,
              options,
              raw,
              sceneEvent,
            });
          }
          if (saved) {
            savedAny = true;
            const fresh = await buildContext(chatId);
            const stage = await computeStage(fresh.chat, fresh.messages);
            send({
              type: "done",
              message: saved,
              options,
              stage: { ...stage, ...(await resolveStageAssets(fresh.chat, stage)) },
            });

            // a mid-scene entrance hands the entered cast the next turns: the narrator
            // stages the arrival and stops — the character speaks for themselves
            // (scene changes excluded: a new scene's opening cast doesn't all speak up)
            if (!regenTarget && speaker.role === "narrator" && sceneEvent?.enter?.length && !sceneEvent.sceneId && !sceneEvent.theEnd) {
              for (const id of sceneEvent.enter) {
                const c = turnCtx.characters.find((x) => x.id === id);
                if (!c) continue;
                if (!infinite && turns + queue.length >= MAX_TURNS) break;
                if (queue[queue.length - 1]?.character?.id === c.id) continue;
                queue.push({ role: "character", character: c });
              }
            }
          } else {
            send({ type: "done", message: null, options: null, stage: null });
          }
        } else {
          send({ type: "done", message: null, options: null, stage: null });
        }
        if (failed) break;

        // characters pass the turn with <mention> tags (never themselves, and mentions
        // of the user resolve to nobody); MAX_TURNS and no back-to-back repeats keep it finite
        if (!regenTarget && speaker.role === "character" && content && turnCtx.present.length > 1) {
          const chained = mentionedPresent(turnCtx, content, speaker.character!.id);
          for (const c of chained) {
            if (!infinite && turns + queue.length >= MAX_TURNS) break;
            if (queue[queue.length - 1]?.character?.id === c.id) continue;
            queue.push({ role: "character", character: c });
          }
        }
      }

      if (savedAny) {
        void runMemoryPass(chatId).catch(() => {});
        void maybeGenerateTitle(chatId).catch(() => {});
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
});
