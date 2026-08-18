import { bad, handler } from "@/lib/api";
import { AiConfigError, callLlm, extractJson, resolveModel, streamLlm } from "@/lib/ai/client";
import {
  addressedManuscriptCharacters,
  buildManuscriptCharacterRequest,
  buildManuscriptOrchestratorRequest,
  MAX_MANUSCRIPT_CONVERSATION_TURNS,
  tagManuscriptConversationMentions,
} from "@/lib/ai/manuscriptConversation";
import {
  MANUSCRIPT_CHARACTER_VOICE_INSTRUCTION,
  MAX_CHARACTER_DESIGN_OPERATIONS,
  validateCharacterDesignResult,
} from "@/lib/ai/manuscriptCharacterDesign";
import { describePartialProgress, dropOpenArrayElement, parsePartialJson } from "@/lib/ai/partialJson";
import {
  manuscriptIncludesActiveChapter,
  manuscriptInputBudget,
  manuscriptResponseTokens,
  packManuscriptPrompt,
  type ManuscriptGenerationAction,
  type ManuscriptContextState,
} from "@/lib/ai/manuscriptContext";
import { getSettings } from "@/lib/store";
import { type Manuscript, type ManuscriptCharacter, type ManuscriptConversationMessage, type ManuscriptMessage, type Settings } from "@/lib/types";
import { countWords } from "@/lib/wordCount";

type Action = ManuscriptGenerationAction;

interface Body {
  action: Action;
  manuscript: Manuscript;
  chapterId?: string;
  quote?: string;
  quoteStart?: number;
  quoteEnd?: number;
  prompt?: string;
  characterIds?: string[];
  includeActiveChapter?: boolean;
  messages?: (ManuscriptMessage | ManuscriptConversationMessage)[];
}

const ACTIONS = new Set<Action>([
  "continue", "rewrite", "assistant", "settings-assistant", "character-design",
  "synopsis", "style", "character", "conversation-chat",
]);
const FIELDS_OPEN = "<fields>";
const FIELDS_CLOSE = "</fields>";
const ELIDED_FIELDS = `${FIELDS_OPEN}(elided — applied to the manuscript form)${FIELDS_CLOSE}`;

function contextOf(
  manuscript: Manuscript,
  chapterId?: string,
  includeActiveChapter = true,
  limits?: Pick<ManuscriptContextState<unknown>, "chapterContent" | "chapterTruncated" | "historyTruncated">
) {
  const chapter = manuscript.chapters.find((c) => c.id === chapterId) ?? manuscript.chapters[0];
  const contextLimitNotices = [
    limits?.chapterTruncated
      ? "Only an excerpt of the active chapter is present. Its middle was omitted to fit the selected model's context window."
      : null,
    limits?.historyTruncated
      ? "Older conversation messages were omitted to fit the selected model's context window."
      : null,
  ].filter((notice): notice is string => !!notice);
  return {
    title: manuscript.name,
    synopsis: manuscript.synopsis,
    perspective: manuscript.perspective,
    style: manuscript.style,
    chapters: manuscript.chapters.map((c) => ({ title: c.title, words: countWords(c.content) })),
    characters: manuscript.characters.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      personality: c.personality,
      appearance: c.appearance,
      voice: c.voice,
    })),
    activeChapter: includeActiveChapter && chapter
      ? { title: chapter.title, content: limits?.chapterContent ?? chapter.content }
      : null,
    ...(contextLimitNotices.length ? { contextLimitNotices } : {}),
  };
}

function contextLimitEvent(packed: {
  chapterTruncated: boolean;
  originalChapterTokens: number;
  includedChapterTokens: number;
  omittedHistoryMessages: number;
}) {
  if (!packed.chapterTruncated && !packed.omittedHistoryMessages) return null;
  return {
    type: "context-limit",
    chapter: packed.chapterTruncated ? {
      originalTokens: packed.originalChapterTokens,
      includedTokens: packed.includedChapterTokens,
    } : null,
    omittedHistoryMessages: packed.omittedHistoryMessages,
  };
}

async function conversationResponse(
  body: Body,
  settings: Settings,
  requestSignal: AbortSignal
): Promise<Response> {
  const requestedCharacterIds = new Set(
    Array.isArray(body.characterIds)
      ? body.characterIds.filter((id): id is string => typeof id === "string")
      : []
  );
  const cast = body.manuscript.characters.filter(
    (character) => requestedCharacterIds.has(character.id)
  );
  if (!cast.length || cast.length !== requestedCharacterIds.size) {
    return bad("conversation characters not found");
  }

  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((message): message is ManuscriptConversationMessage => {
      if (!message || !("characterId" in message) || typeof message.content !== "string") return false;
      if (message.role === "user") return message.characterId === null;
      return message.role === "character"
        && typeof message.characterId === "string"
        && requestedCharacterIds.has(message.characterId);
    });
  const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
  if (lastUserIndex < 0) return bad("message required");
  messages[lastUserIndex] = {
    ...messages[lastUserIndex],
    content: tagManuscriptConversationMentions(messages[lastUserIndex].content, cast),
  };

  let speakers = addressedManuscriptCharacters(messages[lastUserIndex].content, cast);
  try {
    if (!speakers.length && cast.length > 1) {
      const orchestratorModel = await resolveModel("orchestrator");
      const request = buildManuscriptOrchestratorRequest(messages, cast);
      const raw = await callLlm({
        modelRef: orchestratorModel,
        system: request.system,
        messages: request.messages,
        maxTokens: 100,
        feature: "orchestrator",
      });
      const next = extractJson<{ next?: string }>(raw)?.next;
      speakers = [cast.find((character) => character.id === next) ?? cast[0]];
    } else if (!speakers.length) {
      speakers = [cast[0]];
    }
    const chatModel = await resolveModel("chat");
    const includeActiveChapter = body.includeActiveChapter !== false;
    const chapter = body.manuscript.chapters.find((item) => item.id === body.chapterId)
      ?? body.manuscript.chapters[0];
    const responseTokens = manuscriptResponseTokens(settings, "conversation-chat");
    const inputBudget = manuscriptInputBudget(settings, chatModel, responseTokens);
    const encoder = new TextEncoder();
    const abort = new AbortController();
    requestSignal.addEventListener("abort", () => abort.abort());
    if (requestSignal.aborted) abort.abort();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (value: unknown) => {
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`)); } catch { /* disconnected */ }
        };
        const queue = [...speakers];
        let turns = 0;
        let contextLimitSent = false;
        while (queue.length && turns < MAX_MANUSCRIPT_CONVERSATION_TURNS && !abort.signal.aborted) {
          const speaker = queue.shift()!;
          turns++;
          const packed = packManuscriptPrompt({
            chapterContent: includeActiveChapter && chapter ? chapter.content : null,
            history: messages,
            inputBudget,
            preserveHistoryItem: (_message, index) => index === lastUserIndex,
            build: (state) => buildManuscriptCharacterRequest(
              contextOf(body.manuscript, body.chapterId, includeActiveChapter, state),
              state.history,
              cast,
              speaker,
              settings.language
            ),
          });
          if (packed.overBudget) {
            send({ type: "error", message: "The manuscript context is larger than the selected model's input window even after shortening it." });
            break;
          }
          const limitEvent = contextLimitEvent(packed);
          if (limitEvent && !contextLimitSent) {
            send(limitEvent);
            contextLimitSent = true;
          }
          send({ type: "start", speaker: { role: "character", characterId: speaker.id } });
          let content = "";
          let failed = false;
          try {
            for await (const event of streamLlm({
              modelRef: chatModel,
              system: packed.request.system,
              messages: packed.request.messages,
              maxTokens: responseTokens,
              temperature: 0.8,
              feature: "chat",
              signal: abort.signal,
            })) {
              if (event.type === "text") {
                content += event.text;
                send({ type: "text", text: event.text });
              }
            }
          } catch (error) {
            failed = true;
            if (!abort.signal.aborted) {
              send({ type: "error", message: error instanceof Error ? error.message : String(error) });
            }
          }
          content = content.trim();
          if (content && !failed) {
            const message: ManuscriptConversationMessage = {
              role: "character",
              characterId: speaker.id,
              content,
              createdAt: Date.now(),
            };
            messages.push(message);
            send({ type: "done", message });
            for (const next of addressedManuscriptCharacters(content, cast, speaker.id)) {
              if (turns + queue.length >= MAX_MANUSCRIPT_CONVERSATION_TURNS) break;
              if (queue.at(-1)?.id !== next.id) queue.push(next);
            }
          } else {
            send({ type: "done", message: null });
          }
          if (failed) break;
        }
        try { controller.close(); } catch { /* disconnected */ }
      },
      cancel() { abort.abort(); },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" },
    });
  } catch (error) {
    return bad(
      error instanceof Error ? error.message : String(error),
      error instanceof AiConfigError ? 409 : 500
    );
  }
}

export const POST = handler(async (req: Request) => {
  const body = (await req.json()) as Body;
  if (!ACTIONS.has(body.action)) return bad("unknown manuscript action");
  if (!body.manuscript || !Array.isArray(body.manuscript.chapters)) return bad("manuscript required");
  if (body.action === "rewrite" && !body.quote?.trim()) return bad("select text to rewrite");
  const settings = await getSettings();
  if (body.action === "conversation-chat") {
    return conversationResponse(body, settings, req.signal);
  }
  let modelRef;
  try {
    modelRef = await resolveModel("manuscript", null, null, body.manuscript.modelId);
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), e instanceof AiConfigError ? 409 : 500);
  }
  let instruction = "";
  switch (body.action) {
    case "continue":
      instruction = `Continue the active chapter naturally from its exact ending. Return only the new prose to append—no heading, commentary, or repetition. User direction: ${body.prompt || "Continue the scene."}`;
      break;
    case "rewrite":
      instruction = `Rewrite only the quoted passage while preserving its meaning and continuity. Return only the replacement prose.\n\nQUOTED PASSAGE:\n${body.quote}\n\nUser direction: ${body.prompt || "Improve clarity, rhythm, and imagery."}`;
      break;
    case "settings-assistant":
      instruction = `Act as the project's synopsis and prose-style editor. Discuss the user's request conversationally and concisely. When creating, revising, or clearing settings, end the reply with ${FIELDS_OPEN}{ "synopsis": "complete replacement", "style": "complete replacement" }${FIELDS_CLOSE}. Include only fields the user asked to change, use an empty string to clear one, and return the full replacement value rather than a diff. A discussion-only reply has no fields block and changes nothing. Never claim a change unless this reply contains the block.`;
      break;
    case "character-design":
      instruction = `Act as the project's character designer. Discuss the user's request conversationally and concisely. When creating or updating one or more embedded characters, end the reply with ${FIELDS_OPEN}{
  "operations": [
    {
      "operation": "create",
      "characterId": null,
      "character": { "name": "", "description": "", "personality": "", "appearance": "", "voice": "" }
    }
  ]
}${FIELDS_CLOSE}. Existing character IDs are in PROJECT CONTEXT. Set each operation to "create" or "update"; updates must use the exact existing character ID, while creates use null. Return one operation for every requested character, up to ${MAX_CHARACTER_DESIGN_OPERATIONS}. Every operation must contain a complete character sheet with all five string fields. ${MANUSCRIPT_CHARACTER_VOICE_INSTRUCTION} Preserve established details unless asked to change them. A discussion-only or ambiguous reply has no fields block and changes nothing. Never claim a change unless this reply contains the block.`;
      break;
    case "synopsis":
      instruction = `Create or improve the manuscript synopsis. Return only the synopsis, in 1–4 concise paragraphs. User direction: ${body.prompt || "Build a compelling, internally consistent synopsis from the project."}`;
      break;
    case "style":
      instruction = `Create a practical prose-style guide for this manuscript: voice, diction, sentence rhythm, imagery, dialogue, and constraints. Return only the style guide. User direction: ${body.prompt || "Derive a distinctive style suited to this project."}`;
      break;
    case "character":
      instruction = `Create one embedded character that fits this manuscript. Return only valid JSON with exactly these string fields: name, description, personality, appearance, voice. ${MANUSCRIPT_CHARACTER_VOICE_INSTRUCTION} User direction: ${body.prompt || "Create a dramatically useful character."}`;
      break;
    default:
      instruction = `Act as the manuscript assistant. Discuss the active chapter, prose, plot, pacing, and continuity concretely. When quoted text is present, treat it as the user's selected manuscript passage. Do not claim to have edited the document; direct prose edits happen through Continue and Rewrite.\n\nSelected quote:\n${body.quote || "(none)"}`;
  }
  if (body.action === "settings-assistant" || body.action === "character-design") {
    instruction += `\nThe fields block must contain valid JSON. Earlier applied blocks in conversation history may appear as ${ELIDED_FIELDS}; that marker only records a prior application—never emit or copy it yourself.`;
  }

  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter((message): message is ManuscriptMessage =>
      !!message
      && typeof message.content === "string"
      && (message.role === "user" || message.role === "assistant")
    )
    .map((message) => ({
      role: message.role,
      content: message.role === "assistant" && message.applied
        ? `${message.content}\n\n${ELIDED_FIELDS}`
        : message.content,
    }));
  const conversational = ["assistant", "settings-assistant", "character-design"].includes(body.action);
  if (!conversational) {
    history.push({ role: "user", content: body.prompt?.trim() || "Please do the task now." });
  } else if (!history.length && body.prompt?.trim()) {
    history.push({ role: "user", content: body.prompt.trim() });
  }
  if (!history.length) return bad("message required");

  const responseTokens = manuscriptResponseTokens(settings, body.action);
  const includeActiveChapter = manuscriptIncludesActiveChapter(
    body.action,
    body.includeActiveChapter ?? body.manuscript.assistantIncludeActiveChapter
  );
  const chapter = body.manuscript.chapters.find((item) => item.id === body.chapterId)
    ?? body.manuscript.chapters[0];
  const packed = packManuscriptPrompt({
    chapterContent: includeActiveChapter ? chapter?.content ?? null : null,
    history,
    inputBudget: manuscriptInputBudget(settings, modelRef, responseTokens),
    chapterFocus: typeof body.quoteStart === "number" && typeof body.quoteEnd === "number"
      ? { start: body.quoteStart, end: body.quoteEnd }
      : undefined,
    build: (state) => {
      const context = contextOf(body.manuscript, body.chapterId, includeActiveChapter, state);
      return {
        system:
          `You are an expert manuscript assistant. Respond in ${settings.language}. ` +
          `Honor the project's perspective and style, preserve established facts, and never invent prior chapter events that conflict with the supplied project.\n\n` +
          `PROJECT CONTEXT:\n${JSON.stringify(context, null, 2)}\n\n` +
          `TASK:\n${instruction}`,
        messages: state.history,
      };
    },
  });
  if (packed.overBudget) {
    return bad("The manuscript context is larger than the selected model's input window even after shortening it.", 413);
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  if (req.signal.aborted) abort.abort();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (value: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`)); } catch { /* disconnected */ }
      };
      let collected = "";
      const fieldsAction = body.action === "settings-assistant" || body.action === "character-design";
      let fieldsBuffer = "";
      let visibleLength = 0;
      let fieldsStart = -1;
      let inFields = false;
      let lastPartialJson = "";
      let lastPartialAt = 0;
      let partialBroken = false;
      let truncated = false;

      const flushVisible = () => {
        if (!fieldsAction || inFields) return;
        const index = fieldsBuffer.indexOf(FIELDS_OPEN);
        if (index !== -1) {
          const visible = fieldsBuffer.slice(visibleLength, index);
          if (visible) send({ type: "text", text: visible });
          visibleLength = index;
          fieldsStart = index + FIELDS_OPEN.length;
          inFields = true;
          send({ type: "drafting" });
          return;
        }
        let safeEnd = fieldsBuffer.length;
        for (let length = Math.min(FIELDS_OPEN.length - 1, fieldsBuffer.length); length > 0; length--) {
          if (fieldsBuffer.endsWith(FIELDS_OPEN.slice(0, length))) {
            safeEnd = fieldsBuffer.length - length;
            break;
          }
        }
        if (safeEnd > visibleLength) {
          send({ type: "text", text: fieldsBuffer.slice(visibleLength, safeEnd) });
          visibleLength = safeEnd;
        }
      };

      const maybeSendPartial = () => {
        if (!fieldsAction || fieldsStart === -1 || partialBroken) return;
        const now = Date.now();
        if (now - lastPartialAt < 150) return;
        lastPartialAt = now;
        const parsed = parsePartialJson(fieldsBuffer.slice(fieldsStart));
        if (!parsed) {
          partialBroken = true;
          return;
        }
        const raw = body.action === "character-design" ? dropOpenArrayElement(parsed) : parsed.value;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
        const label = describePartialProgress(parsed);
        if (body.action === "settings-assistant") {
          const value = raw as Record<string, unknown>;
          const update: { synopsis?: string; style?: string } = {};
          if (typeof value.synopsis === "string") update.synopsis = value.synopsis;
          if (typeof value.style === "string") update.style = value.style;
          if (!Object.keys(update).length) {
            send({ type: "drafting", label });
            return;
          }
          const json = JSON.stringify(update);
          if (json !== lastPartialJson) {
            lastPartialJson = json;
            send({ type: "settings-update-partial", update, label });
          }
          return;
        }
        const validation = validateCharacterDesignResult(
          raw,
          new Set(body.manuscript.characters.map((item) => item.id))
        );
        if (!validation.ok || !validation.updates.length) {
          send({ type: "drafting", label });
          return;
        }
        const json = JSON.stringify(validation.updates);
        if (json !== lastPartialJson) {
          lastPartialJson = json;
          send({ type: "character-updates-partial", updates: validation.updates, label });
        }
      };

      try {
        const limitEvent = contextLimitEvent(packed);
        if (limitEvent) send(limitEvent);
        for await (const ev of streamLlm({
          modelRef,
          system: packed.request.system,
          messages: packed.request.messages,
          maxTokens: responseTokens,
          temperature: 0.8,
          feature: "manuscript",
          signal: abort.signal,
        })) {
          if (ev.type === "text") {
            if (fieldsAction) {
              fieldsBuffer += ev.text;
              flushVisible();
              if (inFields) maybeSendPartial();
            } else {
              collected += ev.text;
              if (body.action !== "character") send({ type: "text", text: ev.text });
            }
          } else if (ev.type === "stop") {
            truncated = ev.truncated;
          }
        }
        if (fieldsAction && !inFields && visibleLength < fieldsBuffer.length) {
          send({ type: "text", text: fieldsBuffer.slice(visibleLength) });
        }
        if (body.action === "character") {
          const parsed = extractJson<Partial<ManuscriptCharacter>>(collected);
          if (!parsed?.name) send({ type: "error", message: "The model did not return a valid character sheet." });
          else send({ type: "character", character: parsed });
        } else if (fieldsAction) {
          const match = fieldsBuffer.match(new RegExp(`${FIELDS_OPEN}([\\s\\S]*?)(?:${FIELDS_CLOSE}|$)`));
          if (match) {
            try {
              const raw = JSON.parse(match[1].trim()) as Record<string, unknown>;
              if (body.action === "settings-assistant") {
                const update: { synopsis?: string; style?: string } = {};
                if (typeof raw.synopsis === "string") update.synopsis = raw.synopsis;
                if (typeof raw.style === "string") update.style = raw.style;
                if (Object.keys(update).length) send({ type: "settings-update", update });
              } else {
                const validation = validateCharacterDesignResult(
                  raw,
                  new Set(body.manuscript.characters.map((item) => item.id))
                );
                if (!validation.ok) throw new Error(validation.error);
                if (validation.updates.length) {
                  send({ type: "character-updates", updates: validation.updates });
                }
              }
            } catch (error) {
              console.error("manuscript assistant: fields block failed to parse:", error);
              send({
                type: "text",
                text: truncated
                  ? "\n(My response limit was reached before the changes were complete. No incomplete changes were applied.)"
                  : lastPartialJson
                    ? "\n(Some structured data was malformed. The streamed preview was discarded.)"
                    : "\n(I produced malformed structured data, so no changes were applied.)",
              });
            }
          } else if (truncated) {
            send({ type: "text", text: "\n(My response limit was reached—ask me to continue.)" });
          }
        }
        send({ type: "done" });
      } catch (e) {
        if (!abort.signal.aborted) send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        try { controller.close(); } catch { /* disconnected */ }
      }
    },
    cancel() { abort.abort(); },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" },
  });
});
