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
  buildNarratorRequest,
  buildOrchestratorRequest,
  buildTitleRequest,
  computeStage,
  resolveStageAssets,
  type ChatContext,
} from "@/lib/ai/prompts";
import { TagStreamParser, type TagEvent } from "@/lib/ai/tags";
import {
  appendMessage,
  getMessage,
  getScene,
  getStory,
  saveChat,
  updateMessage,
} from "@/lib/store";
import type { Character, Message, SceneEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

interface GenerateBody {
  /** auto = orchestrator decides; character/narrator force a speaker */
  mode?: "auto" | "character" | "narrator";
  characterId?: string;
  /** append this user message before generating (omit to just continue) */
  userText?: string;
  /** regenerate: add a new swipe variant to this existing message */
  regenerateMessageId?: string;
}

async function pickSpeaker(
  ctx: ChatContext,
  body: GenerateBody
): Promise<{ role: "character" | "narrator"; character: Character | null }> {
  if (body.mode === "narrator") return { role: "narrator", character: null };
  if (body.mode === "character" && body.characterId) {
    const c = ctx.characters.find((x) => x.id === body.characterId);
    if (!c) throw new Error("Character not in this chat");
    return { role: "character", character: c };
  }
  if (ctx.characters.length === 1 && !ctx.chat.narratorEnabled) {
    return { role: "character", character: ctx.characters[0] };
  }
  if (ctx.characters.length === 0) {
    if (ctx.chat.narratorEnabled) return { role: "narrator", character: null };
    throw new Error("Chat has no characters");
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
  const c = ctx.characters.find((x) => x.id === next);
  return { role: "character", character: c ?? ctx.characters[0] };
}

function nextSceneEvent(ctx: ChatContext): SceneEvent | null {
  if (!ctx.chat.storyId || !ctx.stage.sceneId) return null;
  const story = getStory(ctx.chat.storyId);
  if (!story) return null;
  const idx = story.sceneIds.indexOf(ctx.stage.sceneId);
  if (idx === -1 || idx >= story.sceneIds.length - 1) return null;
  const nextId = story.sceneIds[idx + 1];
  return { kind: "scene", sceneId: nextId, locationId: getScene(nextId)?.locationId ?? null };
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

  // append the user's message first so it's part of the context
  if (body.userText?.trim()) {
    appendMessage({ chatId, role: "user", content: body.userText.trim() });
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

  let speaker: { role: "character" | "narrator"; character: Character | null };
  let modelRef: ResolvedModel;
  try {
    if (regenTarget) {
      speaker =
        regenTarget.role === "narrator"
          ? { role: "narrator", character: null }
          : {
              role: "character",
              character: ctx.characters.find((c) => c.id === regenTarget!.characterId) ?? null,
            };
      if (speaker.role === "character" && !speaker.character) return bad("Character no longer in chat");
    } else {
      speaker = await pickSpeaker(ctx, body);
    }
    modelRef = resolveModel(speaker.role === "narrator" ? "narrator" : "chat", ctx.chat, speaker.character?.id);
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), e instanceof AiConfigError ? 409 : 400);
  }

  // safety valve: catch up summarization before assembling a prompt that won't fit
  await ensureMemoryCaughtUp(chatId, ctx.chunkThreshold);
  ctx = regenTarget
    ? { ...buildContext(chatId), messages: ctx.messages }
    : buildContext(chatId);

  const built =
    speaker.role === "narrator"
      ? buildNarratorRequest(ctx, modelRef)
      : buildCharacterRequest(ctx, speaker.character!, modelRef);

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
      let content = "";
      let emotion: string | null = null;
      let options: string[] | null = null;
      let sawNextScene = false;
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
          }
        }
      };

      send({
        type: "start",
        speaker: { role: speaker.role, characterId: speaker.character?.id ?? null },
      });

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
      }

      content = content.trim();
      if (content) {
        const sceneEvent = sawNextScene && speaker.role === "narrator" ? nextSceneEvent(ctx) : null;
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
        const fresh = buildContext(chatId);
        const stage = computeStage(fresh.chat, fresh.messages);
        send({
          type: "done",
          message: saved,
          options,
          stage: { ...stage, ...resolveStageAssets(stage) },
        });
        void runMemoryPass(chatId).catch(() => {});
        maybeGenerateTitle(chatId);
      } else {
        send({ type: "done", message: null, options: null, stage: null });
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
