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
  buildMentionResolveRequest,
  buildNarratorRequest,
  buildOrchestratorRequest,
  buildTitleRequest,
  computeStage,
  resolveStageAssets,
  type ChatContext,
} from "@/lib/ai/prompts";
import { TagStreamParser, type TagEvent } from "@/lib/ai/tags";
import { autoFormatUserText } from "@/lib/format";
import { appendMessage, getMessage, getSettings, saveChat, updateMessage } from "@/lib/store";
import type { Character, Message, SceneEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

interface GenerateBody {
  /** auto = orchestrator decides; character/narrator force a speaker */
  mode?: "auto" | "character" | "narrator";
  characterId?: string;
  /** append this user message before generating (omit to just continue) */
  userText?: string;
  /** the text is already in the roleplay convention — skip auto-formatting. Set for the
   *  narrator's suggested actions: they are authored as the user's line, and quoting an
   *  action ("Follow her into the kitchen") would turn it into something the user says. */
  preformatted?: boolean;
  /** regenerate: add a new swipe variant to this existing message */
  regenerateMessageId?: string;
}

interface Speaker {
  role: "character" | "narrator";
  character: Character | null;
}

/** "@name" anywhere at a word start; emails ("a@b") don't count. */
const MENTION_RE = /(^|\s)@\S/;
const ALL_RE = /(^|\s)@all\b/i;

/** Hard cap on AI turns per request — characters chaining @mentions can't loop forever
 *  (lifted while the chat's infinite-mentions override is on). */
const MAX_TURNS = 8;

/** Ask the orchestrator model which characters a message's @mentions address. */
async function resolveMentions(
  ctx: ChatContext,
  text: string,
  author?: Character | null
): Promise<Character[]> {
  const modelRef = resolveModel("orchestrator", ctx.chat);
  const req = buildMentionResolveRequest(ctx, text, author);
  const raw = await callLlm({
    modelRef,
    system: req.system,
    messages: req.messages,
    maxTokens: 120,
    feature: "orchestrator",
    chatId: ctx.chat.id,
  });
  const parsed = extractJson<{ speakers?: string[] }>(raw);
  const out: Character[] = [];
  for (const id of parsed?.speakers ?? []) {
    const c = ctx.present.find((x) => x.id === id);
    if (c && !out.includes(c)) out.push(c);
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

async function pickDefaultSpeaker(ctx: ChatContext, body: GenerateBody): Promise<Speaker> {
  if (ctx.present.length === 1 && !ctx.chat.narratorEnabled) {
    return { role: "character", character: ctx.present[0] };
  }
  if (ctx.present.length === 0) {
    if (ctx.chat.narratorEnabled) return { role: "narrator", character: null };
    throw new Error("Nobody is on stage to reply");
  }
  // group chat and/or narrator: ask the orchestrator
  const modelRef = resolveModel("orchestrator", ctx.chat);
  const req = buildOrchestratorRequest(ctx, modelRef);
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
  if (next === "narrator" && ctx.chat.narratorEnabled) return { role: "narrator", character: null };
  const c = ctx.present.find((x) => x.id === next);
  return { role: "character", character: c ?? ctx.present[0] };
}

/**
 * Who replies to this turn — possibly several speakers:
 * "@all" → every character in chat order; "@name" mentions (partial names,
 * nicknames) → the orchestrator resolves them, each replying in turn.
 */
async function pickSpeakers(ctx: ChatContext, body: GenerateBody): Promise<Speaker[]> {
  if (body.mode === "narrator") return [{ role: "narrator", character: null }];
  if (body.mode === "character" && body.characterId) {
    const c = ctx.present.find((x) => x.id === body.characterId);
    if (!c) throw new Error("Character not on stage in this chat");
    return [{ role: "character", character: c }];
  }
  const text = body.userText?.trim() ?? "";
  if (text && ctx.present.length > 0) {
    if (ALL_RE.test(text)) {
      return ctx.present.map((c) => ({ role: "character" as const, character: c }));
    }
    if (MENTION_RE.test(text)) {
      const mentioned = await resolveMentions(ctx, text);
      if (mentioned.length) return mentioned.map((c) => ({ role: "character" as const, character: c }));
      // no mention matched a character — fall through to normal orchestration
    }
  }
  return [await pickDefaultSpeaker(ctx, body)];
}

function nextSceneId(ctx: ChatContext): string | null {
  const snap = ctx.snapshot;
  if (!snap || !ctx.stage.sceneId) return null;
  const idx = snap.scenes.findIndex((s) => s.scene.id === ctx.stage.sceneId);
  if (idx === -1 || idx >= snap.scenes.length - 1) return null;
  return snap.scenes[idx + 1].scene.id;
}

function maybeGenerateTitle(chatId: string) {
  try {
    const ctx = buildContext(chatId);
    if (ctx.chat.title !== "New chat" || ctx.messages.length < 2) return;
    const modelRef = resolveModel("title", ctx.chat);
    const req = buildTitleRequest(ctx);
    void callLlm({
      modelRef,
      system: req.system,
      messages: req.messages,
      maxTokens: 40,
      feature: "title",
      chatId,
    })
      .then((t) => {
        const title = t.trim().split("\n")[0].replace(/^["'#\s]+|["'\s]+$/g, "").slice(0, 80);
        if (title) saveChat({ id: chatId, title });
      })
      .catch(() => {});
  } catch {
    /* no model configured yet — skip */
  }
}

export const POST = handler(async (req: Request, { params }: IdParams) => {
  const { id: chatId } = await params;
  const body = (await req.json()) as GenerateBody;

  // append the user's message first so it's part of the context. It is stored in the
  // roleplay convention (unmarked runs quoted), while speaker routing below still reads the
  // RAW text — quoting would put a `"` in front of a leading @mention and break the match.
  if (body.userText?.trim()) {
    const raw = body.userText.trim();
    const format = !body.preformatted && getSettings().autoFormatUserMessages;
    appendMessage({ chatId, role: "user", content: format ? autoFormatUserText(raw) : raw });
  }

  let ctx = buildContext(chatId);

  // regeneration targets an existing message; context stops before it
  let regenTarget: Message | null = null;
  if (body.regenerateMessageId) {
    regenTarget = getMessage(body.regenerateMessageId);
    if (!regenTarget || regenTarget.chatId !== chatId) return bad("Message to regenerate not found");
    if (regenTarget.role !== "character" && regenTarget.role !== "narrator")
      return bad("Only AI messages can be regenerated");
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
    resolveModel(
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

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* client disconnected — keep going so the message still gets saved */
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
        const turnCtx = regenTarget ? buildContext(chatId, regenMessages) : buildContext(chatId);

        const infinite = !!turnCtx.chat.overrides.infiniteMentions;
        // kill switch: flipping infinite off mid-chain stops after the reply that just finished
        if (wasInfinite && !infinite) break;
        wasInfinite = infinite;
        if (!infinite && turns >= MAX_TURNS) break;

        const speaker = queue.shift()!;
        turns++;

        let modelRef: ResolvedModel;
        try {
          modelRef = resolveModel(
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
            ? buildNarratorRequest(turnCtx, modelRef)
            : buildCharacterRequest(turnCtx, speaker.character!, modelRef);

        let content = "";
        let emotion: string | null = null;
        let options: string[] | null = null;
        let sawNextScene = false;
        let sawTheEnd = false;
        const enters: string[] = [];
        const leaves: string[] = [];
        const parser = new TagStreamParser();

        const handleEvents = (events: TagEvent[]) => {
          for (const ev of events) {
            if (ev.type === "text") {
              content += ev.text;
              send({ type: "text", text: ev.text });
            } else if (ev.type === "emotion") {
              emotion = emotion ?? ev.name;
              send({ type: "emotion", name: ev.name });
            } else if (ev.type === "options") {
              options = ev.options;
            } else if (ev.type === "nextScene") {
              sawNextScene = true;
            } else if (ev.type === "theEnd") {
              sawTheEnd = true;
            } else if (ev.type === "enter" || ev.type === "leave") {
              // narrator-only staging; resolved to ids at save time (fail-soft)
              (ev.type === "enter" ? enters : leaves).push(ev.name);
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
            maxTokens: speaker.role === "narrator" ? 1000 : 1400,
            feature: speaker.role === "narrator" ? "narrator" : "chat",
            chatId,
            signal: abort.signal,
          })) {
            if (ev.type === "text") handleEvents(parser.feed(ev.text));
          }
          handleEvents(parser.end());
        } catch (e) {
          if (!abort.signal.aborted) {
            handleEvents(parser.end());
            send({ type: "error", message: e instanceof Error ? e.message : String(e) });
          }
          failed = true;
        }

        content = content.trim();
        if (content) {
          // stage events come only from the narrator, and never once the story has ended
          let sceneEvent: SceneEvent | null = null;
          if (speaker.role === "narrator" && turnCtx.snapshot && !turnCtx.ended) {
            const ev: SceneEvent = {};
            if (sawNextScene) {
              const next = nextSceneId(turnCtx);
              if (next) ev.sceneId = next;
            }
            const resolve = (names: string[]) => [
              ...new Set(names.map((n) => matchCharacter(turnCtx, n)?.id).filter((x): x is string => !!x)),
            ];
            const enterIds = resolve(enters);
            const leaveIds = resolve(leaves);
            if (enterIds.length) ev.enter = enterIds;
            if (leaveIds.length) ev.leave = leaveIds;
            if (sawTheEnd) {
              ev.theEnd = true;
              options = null; // no suggested actions under "The End"
            }
            if (Object.keys(ev).length) sceneEvent = ev;
          }
          let saved: Message | null;
          if (regenTarget) {
            const variants = [
              ...regenTarget.variants,
              { content, emotion, options, createdAt: Date.now() },
            ];
            saved = updateMessage(regenTarget.id, {
              variants,
              activeVariant: variants.length - 1,
              sceneEvent: sceneEvent ?? regenTarget.sceneEvent,
            });
          } else {
            saved = appendMessage({
              chatId,
              role: speaker.role,
              characterId: speaker.character?.id ?? null,
              content,
              emotion,
              options,
              sceneEvent,
            });
          }
          savedAny = true;
          const fresh = buildContext(chatId);
          const stage = computeStage(fresh.chat, fresh.messages);
          send({
            type: "done",
            message: saved,
            options,
            stage: { ...stage, ...resolveStageAssets(fresh.chat, stage) },
          });
        } else {
          send({ type: "done", message: null, options: null, stage: null });
        }
        if (failed) break;

        // characters can pass the turn by @mentioning each other (never themselves);
        // the MAX_TURNS cap and no back-to-back repeats keep it finite
        if (!regenTarget && speaker.role === "character" && content && turnCtx.present.length > 1) {
          let chained: Character[] = [];
          if (ALL_RE.test(content)) {
            chained = turnCtx.present.filter((c) => c.id !== speaker.character!.id);
          } else if (MENTION_RE.test(content)) {
            chained = (await resolveMentions(turnCtx, content, speaker.character).catch(() => [])).filter(
              (c) => c.id !== speaker.character!.id
            );
          }
          for (const c of chained) {
            if (!infinite && turns + queue.length >= MAX_TURNS) break;
            if (queue[queue.length - 1]?.character?.id === c.id) continue;
            queue.push({ role: "character", character: c });
          }
        }
      }

      if (savedAny) {
        void runMemoryPass(chatId).catch(() => {});
        maybeGenerateTitle(chatId);
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
